const API_BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Universal API client using native Fetch with credentials
 */
export async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include' // Sends connect-mongo session cookies
  });

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
  getHealth: () => apiFetch('/health'),

  // Station endpoints
  getStations: (params = {}) => {
    const query = new URLSearchParams();
    if (params.type) query.append('type', params.type);
    if (params.status) query.append('status', params.status);
    if (params.includeDeactivated) query.append('includeDeactivated', 'true');
    const queryString = query.toString();
    return apiFetch(`/stations${queryString ? `?${queryString}` : ''}`);
  },
  getStationById: (id) => apiFetch(`/stations/${id}`),
  createStation: (stationData) =>
    apiFetch('/stations', {
      method: 'POST',
      body: JSON.stringify(stationData)
    }),
  updateStation: (id, stationData) =>
    apiFetch(`/stations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(stationData)
    }),
  deactivateStation: (id) =>
    apiFetch(`/stations/${id}`, {
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
    return apiFetch(`/availability${queryString ? `?${queryString}` : ''}`);
  },

  // Booking endpoints
  createBookingHold: (bookingData) =>
    apiFetch('/bookings/hold', {
      method: 'POST',
      body: JSON.stringify(bookingData)
    }),
  confirmBooking: (id, paymentData = {}) =>
    apiFetch(`/bookings/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify(paymentData)
    }),
  releaseBookingHold: (id, reason = 'Customer cancelled hold') =>
    apiFetch(`/bookings/${id}/release`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    }),
  getBookingById: (id) => apiFetch(`/bookings/${id}`),
  getMyBookings: () => apiFetch('/bookings/my-bookings'),

  // Mock Payment Sandbox endpoints
  initiatePayment: ({ bookingId, guestAccessToken }) =>
    apiFetch('/payments/initiate', {
      method: 'POST',
      body: JSON.stringify({
        bookingId,
        ...(guestAccessToken ? { guestAccessToken } : {})
      })
    }),
  simulatePayment: ({ paymentReference, outcome, failureReason }) =>
    apiFetch('/payments/mock-simulate', {
      method: 'POST',
      body: JSON.stringify({
        paymentReference,
        outcome,
        ...(failureReason ? { failureReason } : {})
      })
    }),
  getPaymentStatus: (paymentReference) =>
    apiFetch(`/payments/${paymentReference}/status`),

  // Owner / Staff management endpoints
  getAllBookings: (params = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    if (params.stationId) query.append('stationId', params.stationId);
    if (params.date) query.append('date', params.date);
    const queryString = query.toString();
    return apiFetch(`/bookings${queryString ? `?${queryString}` : ''}`);
  },
  startSession: (id) =>
    apiFetch(`/bookings/${id}/start`, {
      method: 'POST'
    }),
  completeSession: (id) =>
    apiFetch(`/bookings/${id}/complete`, {
      method: 'POST'
    }),
  markNoShow: (id) =>
    apiFetch(`/bookings/${id}/no-show`, {
      method: 'POST'
    }),
  extendSession: (id, extensionMinutes = 15) =>
    apiFetch(`/bookings/${id}/extend`, {
      method: 'POST',
      body: JSON.stringify({ extensionMinutes })
    }),
  createMaintenance: (blockData) =>
    apiFetch('/bookings/maintenance', {
      method: 'POST',
      body: JSON.stringify(blockData)
    }),
  cancelMaintenance: (id) =>
    apiFetch(`/bookings/maintenance/${id}`, {
      method: 'DELETE'
    }),

  // Auth endpoints
  register: (userData) =>
    apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    }),
  login: (credentials) =>
    apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    }),
  logout: () =>
    apiFetch('/auth/logout', {
      method: 'POST'
    }),
  getCurrentUser: () => apiFetch('/auth/me')
};
