import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import {
  BASE_URL,
  JSON_HEADERS,
  getSlotWindow,
  getRunDayOffset,
  fetchAvailableStations,
  getGuestDetails,
} from './helpers.js';

// Custom performance metrics
const paymentInitiations = new Counter('payment_initiations_total');
const paymentSuccessRate = new Rate('payment_initiation_success_rate');
const holdLatency = new Trend('hold_creation_latency', true);
const paymentLatency = new Trend('payment_initiation_latency', true);

// Configurable parameters via environment variables
const VUS = parseInt(__ENV.VUS || '5', 10);
const ITERATIONS = parseInt(__ENV.ITERATIONS || '2', 10);

export const options = {
  scenarios: {
    payment_initiation_flow: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: ITERATIONS,
      maxDuration: '2m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],                  // Less than 2% network/HTTP failures
    http_req_duration: ['p(95)<800', 'p(99)<1500'],  // 95% under 800ms
    payment_initiation_success_rate: ['rate>0.98'],  // 98%+ success rate
    payment_initiation_latency: ['p(95)<500'],       // Fast payment session generation
  },
};

/**
 * Setup runs once before virtual users start.
 * 1. Dynamically queries live stations to verify available inventory.
 * 2. Determines a run-specific calendar day offset to prevent repeat-run collisions.
 */
export function setup() {
  const stations = fetchAvailableStations(BASE_URL);
  if (!stations || stations.length === 0) {
    throw new Error('No available stations found on target server.');
  }

  const baseDaysAhead = getRunDayOffset();

  return {
    stations,
    baseDaysAhead,
    iterations: ITERATIONS,
  };
}

export default function (data) {
  const stations = data.stations && data.stations.length > 0
    ? data.stations
    : ['PC-01', 'PC-02', 'PS5-01', 'PS5-02'];
  const numStations = stations.length;

  // Operating window: 10:00 to 23:00 IST (13 hours = 26 discrete 30-min slots)
  const slotsPerDayPerStation = 26;
  const dailyCapacity = numStations * slotsPerDayPerStation;

  // Collision-free linear slot index: uniquely maps every (VU, Iteration) pair
  // into an orthogonal (day, station, timeSlot) tuple without modulo wrapping collisions
  const globalIndex = (__VU - 1) * data.iterations + __ITER;
  const dayOffset = Math.floor(globalIndex / dailyCapacity);
  const slotInDay = globalIndex % dailyCapacity;

  // Distribute uniformly across stations and discrete 30-minute time intervals
  const stationIndex = slotInDay % numStations;
  const timeSlotIndex = Math.floor(slotInDay / numStations);

  const stationId = stations[stationIndex];
  const totalMinutesFrom10AM = timeSlotIndex * 30;
  const startHourIST = 10 + Math.floor(totalMinutesFrom10AM / 60);
  const startMinuteIST = totalMinutesFrom10AM % 60;
  const daysAhead = data.baseDaysAhead + dayOffset;

  const slot = getSlotWindow({
    daysAhead,
    startHourIST,
    startMinuteIST,
    durationMinutes: 30, // 30-min discrete session within 10:00 - 23:00 IST
  });

  let bookingId = null;
  let guestAccessToken = null;

  group('01. Create Non-Colliding Booking Hold', () => {
    const holdPayload = JSON.stringify({
      stationId,
      startTime: slot.startTime,
      endTime: slot.endTime,
      isGuest: true,
      guestInfo: getGuestDetails(`pay_${__VU}_${__ITER}`),
      paymentType: 'FULL',
      notes: `k6 payment test - VU ${__VU} Iter ${__ITER}`,
    });

    const holdRes = http.post(`${BASE_URL}/bookings/hold`, holdPayload, {
      headers: JSON_HEADERS,
    });

    holdLatency.add(holdRes.timings.duration);

    const holdCheck = check(holdRes, {
      'Hold created with 201': (r) => r.status === 201,
      'Hold returns valid booking ID': (r) => {
        const body = r.json();
        return body && body.data?.booking?._id !== undefined;
      },
      'Hold returns guestAccessToken': (r) => {
        const body = r.json();
        return body && typeof body.data?.guestAccessToken === 'string';
      },
    });

    if (holdCheck) {
      const body = holdRes.json();
      bookingId = body.data.booking._id;
      guestAccessToken = body.data.guestAccessToken;
    } else {
      console.error(`[VU ${__VU} Iter ${__ITER}] Hold failed (${holdRes.status}): ${holdRes.body}`);
    }
  });

  // Short pause to simulate transition from slot picker to payment review
  sleep(0.5);

  if (!bookingId || !guestAccessToken) {
    paymentSuccessRate.add(false);
    return;
  }

  let paymentReference = null;

  group('02. Initiate Mock Payment Session', () => {
    const paymentPayload = JSON.stringify({
      bookingId,
      guestAccessToken,
    });

    const payRes = http.post(`${BASE_URL}/payments/initiate`, paymentPayload, {
      headers: JSON_HEADERS,
    });

    paymentLatency.add(payRes.timings.duration);
    paymentInitiations.add(1);

    const payCheck = check(payRes, {
      'Payment initiation status is 200': (r) => r.status === 200,
      'Returns success true': (r) => {
        const body = r.json();
        return body && body.success === true;
      },
      'Returns MOCK-PAY reference': (r) => {
        const body = r.json();
        const ref = body?.data?.paymentReference;
        return typeof ref === 'string' && ref.startsWith('MOCK-PAY-');
      },
      'Amount due matches positive integer paise': (r) => {
        const body = r.json();
        return body && typeof body.data?.amountPaise === 'number' && body.data.amountPaise > 0;
      },
    });

    if (payCheck) {
      paymentReference = payRes.json().data.paymentReference;
    }
  });

  if (!paymentReference) {
    paymentSuccessRate.add(false);
    return;
  }

  group('03. Verify Persisted PaymentTransaction Status', () => {
    // Query PaymentTransaction status: server route is /api/payments/:paymentReference/status
    // with fallback support for direct /api/payments/:paymentReference
    const statusUrl = `${BASE_URL}/payments/${paymentReference}/status`;
    let statusRes = http.get(statusUrl, { headers: JSON_HEADERS });
    if (statusRes.status === 404) {
      statusRes = http.get(`${BASE_URL}/payments/${paymentReference}`, {
        headers: JSON_HEADERS,
      });
    }

    const statusCheck = check(statusRes, {
      'Payment status check returns 200': (r) => r.status === 200,
      'PaymentTransaction status is INITIATED': (r) => {
        const body = r.json();
        return body && (body.data?.status === 'INITIATED' || body.status === 'INITIATED');
      },
      'PaymentTransaction reference matches': (r) => {
        const body = r.json();
        return (
          body &&
          (body.data?.paymentReference === paymentReference ||
            body.paymentReference === paymentReference)
        );
      },
    });

    // Metric measures end-to-end payment initiation and transaction status verification
    paymentSuccessRate.add(statusCheck);
  });

  sleep(1);
}
