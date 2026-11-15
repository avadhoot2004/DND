import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
  BASE_URL,
  JSON_HEADERS,
  getSlotWindow,
  getRunDayOffset,
  fetchAvailableStations,
  getGuestDetails,
} from './helpers.js';

// Custom metric counters for concurrency outcome verification
const successfulBookings = new Counter('successful_bookings');
const conflictBookings = new Counter('conflict_bookings');
const unexpectedStatus = new Counter('unexpected_status');
const holdDuration = new Trend('booking_hold_duration', true);

// Configurable parameters via environment variables
const VUS = parseInt(__ENV.VUS || '20', 10);

export const options = {
  scenarios: {
    booking_contention: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    // Exact ACID invariant: Exactly 1 VU wins the reservation hold, all other (VUS - 1) receive 409 Conflict
    successful_bookings: ['count==1'],
    conflict_bookings: [`count==${VUS - 1}`],
    unexpected_status: ['count==0'],
  },
};

/**
 * Setup runs once before virtual users start.
 * 1. Dynamically queries live stations to verify available inventory.
 * 2. Establishes a fresh future slot date/time to avoid collisions with prior runs.
 * 3. Defines a synchronized release timestamp barrier for true simultaneous concurrency.
 */
export function setup() {
  const stations = fetchAvailableStations(BASE_URL);
  if (!stations || stations.length === 0) {
    throw new Error('No available stations found on target server.');
  }

  // Allow station override or pick first available active station
  const targetStation = __ENV.STATION_ID || stations[0];

  // Run-specific future date prevents collision with holds from earlier test runs
  const daysAhead = getRunDayOffset();
  const startHourIST = parseInt(__ENV.START_HOUR || '15', 10);

  const slot = getSlotWindow({
    daysAhead,
    startHourIST,
    startMinuteIST: 0,
    durationMinutes: 60,
  });

  // Release barrier: Give all 20 VUs 3.5 seconds to spawn and pre-warm connections
  const releaseTime = Date.now() + 3500;

  return {
    targetStation,
    slot,
    releaseTime,
    stationCount: stations.length,
  };
}

export default function (data) {
  // Pre-warm TCP connection and HTTP keep-alive pool before the barrier
  http.get(`${BASE_URL}/health`, { headers: JSON_HEADERS });

  // Microsecond-level synchronization barrier: sleep until exact release timestamp
  const waitMs = data.releaseTime - Date.now();
  if (waitMs > 0) {
    sleep(waitMs / 1000);
  }

  // Simultaneously fire hold request for the exact same station and slot window
  const payload = JSON.stringify({
    stationId: data.targetStation,
    startTime: data.slot.startTime,
    endTime: data.slot.endTime,
    isGuest: true,
    guestInfo: getGuestDetails(__VU),
    paymentType: 'FULL',
    notes: `k6 concurrency stress test - VU ${__VU}`,
  });

  const res = http.post(`${BASE_URL}/bookings/hold`, payload, {
    headers: JSON_HEADERS,
  });

  holdDuration.add(res.timings.duration);

  if (res.status === 201) {
    successfulBookings.add(1);
    check(res, {
      'Winner received 201 Created': (r) => r.status === 201,
      'Winner response contains booking reference': (r) => {
        const body = r.json();
        return body && body.data?.booking?.bookingReference !== undefined;
      },
      'Winner booking status is PENDING_HOLD': (r) => {
        const body = r.json();
        return body && body.data?.booking?.bookingStatus === 'PENDING_HOLD';
      },
      'Winner received guestAccessToken': (r) => {
        const body = r.json();
        return body && typeof body.data?.guestAccessToken === 'string';
      },
    });
  } else if (res.status === 409) {
    conflictBookings.add(1);
    check(res, {
      'Contender received 409 Conflict': (r) => r.status === 409,
      'Conflict error code is SLOT_UNAVAILABLE': (r) => {
        const body = r.json();
        return body && body.error?.code === 'SLOT_UNAVAILABLE';
      },
    });
  } else {
    unexpectedStatus.add(1);
    console.error(`[VU ${__VU}] Unexpected status ${res.status}: ${res.body}`);
  }
}
