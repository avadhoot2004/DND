/**
 * Common configuration and helper functions for k6 load testing
 * DND Gaming Hub
 */
import http from 'k6/http';

// Base API URL configurable via environment variable (defaults to local express server)
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';

// Standard HTTP headers for JSON API requests
export const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

/**
 * Returns formatted YYYY-MM-DD string for a date N days in the future (in IST).
 * @param {number} daysAhead - Number of days ahead (default: 2 days)
 * @returns {string} Date string YYYY-MM-DD
 */
export function getFutureDateString(daysAhead = 2) {
  const target = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calculates a run-specific day offset to ensure consecutive load-test runs
 * target completely different calendar dates, preventing collisions with holds/bookings
 * from earlier runs. Can be explicitly overridden via DAYS_AHEAD env variable.
 * @returns {number} Days ahead (3 to 30)
 */
export function getRunDayOffset() {
  const envDays = parseInt(__ENV.DAYS_AHEAD || '0', 10);
  if (envDays > 0) return envDays;
  // Compute rolling offset based on current minute of the day (3 to 27)
  const minuteOfDay = Math.floor(Date.now() / 60000);
  return 3 + (minuteOfDay % 25);
}

/**
 * Generates ISO UTC timestamps for a discrete 15-minute slot window
 * matching lounge operating hours (10:00 to 23:00 IST / UTC+05:30).
 *
 * IST is UTC + 5h 30m. Thus UTC time = IST time - 5 hours 30 minutes.
 * Example: 14:00 IST = 08:30 UTC.
 *
 * @param {Object} options
 * @param {number} options.daysAhead - Days ahead (default: 2)
 * @param {number} options.startHourIST - Starting hour in IST (10 to 22, default: 14)
 * @param {number} options.startMinuteIST - Starting minute in IST (0, 15, 30, 45, default: 0)
 * @param {number} options.durationMinutes - Duration in minutes (30 to 240, default: 60)
 * @returns {{ startTime: string, endTime: string, dateString: string }}
 */
export function getSlotWindow({
  daysAhead = 2,
  startHourIST = 14,
  startMinuteIST = 0,
  durationMinutes = 60
} = {}) {
  const target = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const yyyy = target.getUTCFullYear();
  const month = target.getUTCMonth();
  const date = target.getUTCDate();

  // Convert IST (startHourIST:startMinuteIST) to UTC
  // IST = UTC + 5.5 hours
  const totalIstMinutes = startHourIST * 60 + startMinuteIST;
  const totalUtcMinutes = totalIstMinutes - 330; // -5h 30m

  const utcHours = Math.floor(totalUtcMinutes / 60);
  const utcMinutes = totalUtcMinutes % 60;

  const startTime = new Date(Date.UTC(yyyy, month, date, utcHours, utcMinutes, 0, 0));
  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

  const mm = String(month + 1).padStart(2, '0');
  const dd = String(date).padStart(2, '0');
  const dateString = `${yyyy}-${mm}-${dd}`;

  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    dateString,
  };
}

/**
 * Fetch available stations dynamically from the live backend API.
 * Falls back to seeded station identifiers if query fails.
 * @param {string} baseUrl
 * @returns {Array<string>} List of available station identifiers
 */
export function fetchAvailableStations(baseUrl = BASE_URL) {
  try {
    const res = http.get(`${baseUrl}/stations`, { headers: JSON_HEADERS });
    if (res.status === 200) {
      const body = res.json();
      if (body && Array.isArray(body.data) && body.data.length > 0) {
        const active = body.data
          .filter((s) => s.status === 'AVAILABLE')
          .map((s) => s.identifier || s._id);
        if (active.length > 0) return active;
      }
    }
  } catch (err) {
    // Network or parse error, fallback below
  }
  return ['PC-01', 'PC-02', 'PS5-01', 'PS5-02'];
}

/**
 * Generate unique guest customer details for a virtual user.
 * @param {number|string} id - Identifier (e.g. VU number)
 * @returns {{ fullName: string, email: string, phone: string }}
 */
export function getGuestDetails(id = 1) {
  const timestamp = Date.now();
  return {
    fullName: `Load Tester ${id}`,
    email: `loadtest_${id}_${timestamp}@dndgaming.local`,
    phone: '9876543210',
  };
}
