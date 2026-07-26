import { getSession, clearSession } from './session.js';

const REGION = 'us-central1';
// NOTE: replace 'sfayw-prod' with the real deployed project id in Plan 3.
const PROD_PROJECT_ID = 'sfayw-prod';

function functionsBaseUrl() {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocal) return `http://127.0.0.1:5001/demo-sfayw/${REGION}`;
  return `https://${REGION}-${PROD_PROJECT_ID}.cloudfunctions.net`;
}

async function callFunction(name, data = {}) {
  const session = getSession();
  const payload = { ...data };
  if (session?.token && !('sessionToken' in payload)) {
    payload.sessionToken = session.token;
  }

  const res = await fetch(`${functionsBaseUrl()}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: payload }),
  });

  const body = await res.json();

  if (!res.ok || body.error) {
    const status = (body.error?.status || '').toUpperCase();
    const message = body.error?.message || '알 수 없는 오류가 발생했습니다.';

    if (status === 'UNAUTHENTICATED' || status === 'PERMISSION_DENIED') {
      clearSession();
      location.reload();
    }

    const err = new Error(message);
    err.status = status;
    throw err;
  }

  return body.result;
}

async function logout() {
  try {
    await callFunction('logout', {});
  } catch {
    // session was already invalid/expired server-side — clearing locally is enough
  }
  clearSession();
  location.reload();
}

export { callFunction, logout };
