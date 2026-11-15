import request from 'supertest';

/**
 * Logs in a user and retrieves a CSRF token.
 * @param {import('express').Express} app - Express app instance.
 * @param {{email:string,password:string}} credentials - Login credentials.
 * @returns {Promise<{agent:any, csrf:string}>}
 *   agent – a supertest request.agent with session cookies persisted.
 *   csrf – the CSRF token string for the logged‑in session.
 */
export async function loginWithCsrf(app, credentials) {
  // Use a persistent agent to retain cookies across requests.
  const agent = request.agent(app);

  // 1. Perform login.
  const loginRes = await agent
    .post('/api/auth/login')
    .send(credentials);
  if (loginRes.status !== 200) {
    throw new Error(`Login failed with status ${loginRes.status}`);
  }

  // 2. Fetch CSRF token; the endpoint may refresh the session cookie.
  const csrfRes = await agent.get('/api/auth/csrf-token');
  if (csrfRes.status !== 200 || !csrfRes.body?.csrfToken) {
    throw new Error('Failed to obtain CSRF token');
  }

  // Return the agent (already holds cookies) and the token.
  return { agent, csrf: csrfRes.body.csrfToken };
}

