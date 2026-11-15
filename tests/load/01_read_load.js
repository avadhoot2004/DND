import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import {
  BASE_URL,
  JSON_HEADERS,
  getFutureDateString,
  getRunDayOffset,
  fetchAvailableStations,
} from './helpers.js';

// Custom metrics
const errorRate = new Rate('read_error_rate');
const stationsDuration = new Trend('stations_duration', true);
const availabilityDuration = new Trend('availability_duration', true);

// Configurable test parameters via environment variables
const VUS = parseInt(__ENV.VUS || '10', 10);
const DURATION = __ENV.DURATION || '30s';

export const options = {
  scenarios: {
    read_traffic: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],              // Less than 1% failed HTTP requests
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% under 500ms, 99% under 1s
    read_error_rate: ['rate<0.01'],              // Custom check error rate < 1%
    stations_duration: ['p(95)<400'],            // Station queries fast
    availability_duration: ['p(95)<500'],        // Slot availability matrix queries fast
  },
};

/**
 * Setup runs once before virtual users start.
 * Verifies live station availability and dynamically discovers target station identifier.
 */
export function setup() {
  const stations = fetchAvailableStations(BASE_URL);
  if (!stations || stations.length === 0) {
    throw new Error('No available stations found on target server.');
  }

  const sampleStation = __ENV.STATION_ID || stations[0];
  const daysAhead = getRunDayOffset();

  return {
    sampleStation,
    stationCount: stations.length,
    daysAhead,
  };
}

export default function (data) {
  const sampleStation = data?.sampleStation || 'PC-01';
  const queryDate = getFutureDateString(data?.daysAhead || 2);

  group('01. Public Station Listing', () => {
    // 1. Fetch all stations
    const resAll = http.get(`${BASE_URL}/stations`, { headers: JSON_HEADERS });
    stationsDuration.add(resAll.timings.duration);

    const checkAll = check(resAll, {
      'GET /stations status is 200': (r) => r.status === 200,
      'GET /stations returns success true': (r) => {
        const body = r.json();
        return body && body.success === true && Array.isArray(body.data);
      },
      'GET /stations returns active stations': (r) => {
        const body = r.json();
        return body && body.data.length >= 1;
      },
    });
    errorRate.add(!checkAll);

    // 2. Fetch specific station by identifier
    const resSingle = http.get(`${BASE_URL}/stations/${sampleStation}`, { headers: JSON_HEADERS });
    const checkSingle = check(resSingle, {
      'GET /stations/:id status is 200': (r) => r.status === 200,
      'GET /stations/:id returns matching identifier': (r) => {
        const body = r.json();
        return body && body.success === true && body.data.identifier === sampleStation;
      },
    });
    errorRate.add(!checkSingle);
  });

  group('02. Discrete Availability Matrix Query', () => {
    // 3. Query 15-minute slot availability matrix for station on target future date
    const url = `${BASE_URL}/availability?stationId=${sampleStation}&date=${queryDate}`;
    const resAvail = http.get(url, { headers: JSON_HEADERS });
    availabilityDuration.add(resAvail.timings.duration);

    const checkAvail = check(resAvail, {
      'GET /availability status is 200': (r) => r.status === 200,
      'GET /availability returns stations array': (r) => {
        const body = r.json();
        return body && body.success === true && Array.isArray(body.data?.stations);
      },
      'GET /availability returns 15-min slots': (r) => {
        const body = r.json();
        const station = body.data?.stations?.[0];
        return station && Array.isArray(station.slots) && station.slots.length > 0;
      },
    });
    errorRate.add(!checkAvail);
  });

  group('03. Gateway Health Heartbeat', () => {
    const resHealth = http.get(`${BASE_URL}/health`, { headers: JSON_HEADERS });
    const checkHealth = check(resHealth, {
      'GET /health status is 200': (r) => r.status === 200,
      'GET /health reports healthy status': (r) => {
        const body = r.json();
        return (
          body &&
          (body.success === true ||
            body.status === 'ok' ||
            body.data?.status === 'healthy')
        );
      },
    });
    errorRate.add(!checkHealth);
  });

  // Paced sleep between iterations to simulate realistic human browsing
  sleep(1);
}
