export async function fetchCsrf(request, app, cookie) {
  const res = await request(app)
    .get('/api/auth/csrf-token')
    .set('Cookie', cookie);
  if (res.status !== 200 || !res.body.csrfToken) {
    throw new Error(`fetchCsrf failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.csrfToken;
}

