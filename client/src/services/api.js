const API_BASE = import.meta.env.VITE_API_URL || '/api';

let csrfToken = null;

/**
 * Fetch and cache CSRF token from the backend.
 * Returns the cached token. Throws an Error with status code if not ok.
 */
export async function fetchCsrfToken() {
  const url = `${API_BASE}/auth/csrf-token`;
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch CSRF token: HTTP ${response.status}`);
  }

  const data = await response.json().catch(() => null);
  csrfToken = data?.csrfToken || null;
  return csrfToken;
}

/**
 * Universal fetch wrapper with credentials and automatic CSRF handling.
 * Returns raw Response object.
 */
export async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : endpoint.startsWith(API_BASE)
    ? endpoint
    : `${API_BASE}${endpoint}`;

  const method = (options.method || 'GET').toUpperCase();

  const headers = options.headers instanceof Headers
    ? options.headers
    : {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!csrfToken) {
      try {
        await fetchCsrfToken();
      } catch (err) {
        // Guest or unauthenticated requests are CSRF-exempt on the backend
      }
    }
    if (csrfToken) {
      if (headers instanceof Headers) {
        headers.set('X-CSRF-Token', csrfToken);
      } else {
        headers['X-CSRF-Token'] = csrfToken;
      }
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });

  return response;
}

async function request(endpoint, options = {}) {
  const response = await apiFetch(endpoint, options);

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.error?.message || `HTTP ${response.status} Request Failed`);
    error.status = response.status;
    error.code = data?.error?.code || 'API_ERROR';
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  fetchCsrfToken,
  getHealth: () => request('/health'),

  // Station endpoints
  getStations: (params = {}) => {
    const query = new URLSearchParams();
    if (params.type) query.append('type', params.type);
    if (params.status) query.append('status', params.status);
    if (params.includeDeactivated) query.append('includeDeactivated', 'true');
    const queryString = query.toString();
    return request(`/stations${queryString ? `?${queryString}` : ''}`);
  },
  getStationById: (id) => request(`/stations/${id}`),
  createStation: (stationData) =>
    request('/stations', {
      method: 'POST',
      body: JSON.stringify(stationData)
    }),
  updateStation: (id, stationData) =>
    request(`/stations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(stationData)
    }),
  deactivateStation: (id) =>
    request(`/stations/${id}`, {
      method: 'DELETE'
    }),

  // Availability endpoint
  getAvailability: (params = {}) => {
    const query = new URLSearchParams();
    if (params.stationId) query.append('stationId', params.stationId);
    if (params.date) query.append('date', params.date);
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);
    if (params.type) query.append('type', params.type);
    const queryString = query.toString();
    return request(`/availability${queryString ? `?${queryString}` : ''}`);
  },

  // Booking endpoints
  createBookingHold: (bookingData) =>
    request('/bookings/hold', {
      method: 'POST',
      body: JSON.stringify(bookingData)
    }),
  confirmBooking: (id, paymentData = {}) =>
    request(`/bookings/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify(paymentData)
    }),
  releaseBookingHold: (id, reason = 'Customer cancelled hold') =>
    request(`/bookings/${id}/release`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    }),
  getBookingById: (id) => request(`/bookings/${id}`),
  getMyBookings: () => request('/bookings/my-bookings'),

  // Mock Payment Sandbox endpoints
  initiatePayment: ({ bookingId, guestAccessToken }) =>
    request('/payments/initiate', {
      method: 'POST',
      body: JSON.stringify({
        bookingId,
        ...(guestAccessToken ? { guestAccessToken } : {})
      })
    }),
  simulatePayment: ({ paymentReference, outcome, failureReason }) =>
    request('/payments/mock-simulate', {
      method: 'POST',
      body: JSON.stringify({
        paymentReference,
        outcome,
        ...(failureReason ? { failureReason } : {})
      })
    }),
  getPaymentStatus: (paymentReference) =>
    request(`/payments/${paymentReference}/status`),

  // Owner / Staff management endpoints
  getAllBookings: (params = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    if (params.stationId) query.append('stationId', params.stationId);
    if (params.date) query.append('date', params.date);
    const queryString = query.toString();
    return request(`/bookings${queryString ? `?${queryString}` : ''}`);
  },
  startSession: (id) =>
    request(`/bookings/${id}/start`, {
      method: 'POST'
    }),
  completeSession: (id) =>
    request(`/bookings/${id}/complete`, {
      method: 'POST'
    }),
  markNoShow: (id) =>
    request(`/bookings/${id}/no-show`, {
      method: 'POST'
    }),
  extendSession: (id, extensionMinutes = 15) =>
    request(`/bookings/${id}/extend`, {
      method: 'POST',
      body: JSON.stringify({ extensionMinutes })
    }),
  createMaintenance: (blockData) =>
    request('/bookings/maintenance', {
      method: 'POST',
      body: JSON.stringify(blockData)
    }),
  cancelMaintenance: (id) =>
    request(`/bookings/maintenance/${id}`, {
      method: 'DELETE'
    }),

  // Auth endpoints
  register: (userData) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    }),
  login: (credentials) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    }),
  logout: () => {
    csrfToken = null;
    return request('/auth/logout', {
      method: 'POST'
    });
  },
  getCurrentUser: () => request('/auth/me')
};
