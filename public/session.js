const STORAGE_KEY = 'sfayw_session';

function getSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  if (typeof session !== 'object' || session === null) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  if (typeof session.expiresAt !== 'number' || session.expiresAt < Date.now()) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  return session;
}

function setSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export { getSession, setSession, clearSession };
