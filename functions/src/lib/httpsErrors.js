const { HttpsError } = require('firebase-functions/v2/https');

/**
 * Domain errors that mean "the caller sent something we cannot accept".
 * Anything not classified here (or by the rules in toHttpsError) is treated as
 * a bug and reported as a generic internal error, so internal failure messages
 * never leak to the client.
 */
const DOMAIN_ERROR_CODES = new Set([
  'INVALID_PASSWORD', 'INVALID_PIN', 'MEMBER_NOT_FOUND', 'MISSING_FIELDS',
  'SLUG_TAKEN', 'NAME_REQUIRED', 'NAME_TAKEN', 'INVALID_CATEGORY', 'INVALID_AMOUNT',
  'ENTERED_BY_REQUIRED', 'EXPENSE_LOCKED', 'INVALID_STATUS', 'INVALID_WEIGHT',
  'INVALID_EXCLUDED_CATEGORIES', 'INVALID_MIME_TYPE',
]);

function toHttpsError(err) {
  const message = err.message || '';

  if (message === 'UNAUTHENTICATED' || message === 'SESSION_EXPIRED') {
    return new HttpsError('unauthenticated', message);
  }
  if (message === 'FORBIDDEN') {
    return new HttpsError('permission-denied', message);
  }
  if (message === 'RATE_LIMITED' || message === 'TOO_MANY_ATTEMPTS') {
    return new HttpsError('resource-exhausted', message);
  }
  if (message.endsWith('_NOT_FOUND') || message === 'NO_PHOTO') {
    return new HttpsError('not-found', message);
  }
  if (DOMAIN_ERROR_CODES.has(message)) {
    return new HttpsError('invalid-argument', message);
  }

  console.error('Unexpected error in Cloud Function:', err);
  return new HttpsError('internal', 'INTERNAL_ERROR');
}

module.exports = { toHttpsError, DOMAIN_ERROR_CODES };
