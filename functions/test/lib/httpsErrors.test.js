const { toHttpsError } = require('../../src/lib/httpsErrors');

describe('toHttpsError', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('maps auth failures to unauthenticated', () => {
    for (const code of ['UNAUTHENTICATED', 'SESSION_EXPIRED']) {
      const err = toHttpsError(new Error(code));
      expect(err.code).toBe('unauthenticated');
      expect(err.message).toBe(code);
    }
  });

  test('maps FORBIDDEN to permission-denied', () => {
    const err = toHttpsError(new Error('FORBIDDEN'));
    expect(err.code).toBe('permission-denied');
    expect(err.message).toBe('FORBIDDEN');
  });

  test('maps both throttling errors to resource-exhausted', () => {
    for (const code of ['RATE_LIMITED', 'TOO_MANY_ATTEMPTS']) {
      const err = toHttpsError(new Error(code));
      expect(err.code).toBe('resource-exhausted');
      expect(err.message).toBe(code);
    }
  });

  test('maps every _NOT_FOUND error to not-found', () => {
    for (const code of ['TRIP_NOT_FOUND', 'MEMBER_NOT_FOUND', 'EXPENSE_NOT_FOUND']) {
      const err = toHttpsError(new Error(code));
      expect(err.code).toBe('not-found');
      expect(err.message).toBe(code);
    }
  });

  test('maps NO_PHOTO to not-found', () => {
    const err = toHttpsError(new Error('NO_PHOTO'));
    expect(err.code).toBe('not-found');
    expect(err.message).toBe('NO_PHOTO');
  });

  test('maps validation errors to invalid-argument', () => {
    const codes = [
      'INVALID_PASSWORD', 'INVALID_PIN', 'MISSING_FIELDS', 'SLUG_TAKEN', 'NAME_REQUIRED',
      'NAME_TAKEN', 'INVALID_CATEGORY', 'INVALID_AMOUNT', 'ENTERED_BY_REQUIRED',
      'EXPENSE_LOCKED', 'INVALID_STATUS', 'INVALID_WEIGHT', 'INVALID_EXCLUDED_CATEGORIES',
      'INVALID_MIME_TYPE',
    ];
    for (const code of codes) {
      const err = toHttpsError(new Error(code));
      expect(err.code).toBe('invalid-argument');
      expect(err.message).toBe(code);
    }
  });

  test('hides an unrecognised error behind a generic internal error', () => {
    const err = toHttpsError(new TypeError("Cannot read properties of undefined (reading 'name')"));
    expect(err.code).toBe('internal');
    expect(err.message).toBe('INTERNAL_ERROR');
    expect(err.message).not.toMatch(/undefined/);
  });

  test('logs the unrecognised error server-side instead of dropping it', () => {
    const original = new Error('ECONNREFUSED 10.0.0.1:443');
    toHttpsError(original);
    expect(consoleError).toHaveBeenCalledWith('Unexpected error in Cloud Function:', original);
  });

  test('does not leak internal Gemini failure detail to the client', () => {
    const err = toHttpsError(new Error('GEMINI_HTTP_500'));
    expect(err.code).toBe('internal');
    expect(err.message).toBe('INTERNAL_ERROR');
  });

  test('treats an error with no message as internal without throwing', () => {
    const err = toHttpsError(new Error());
    expect(err.code).toBe('internal');
    expect(err.message).toBe('INTERNAL_ERROR');
  });
});
