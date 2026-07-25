const { hashSecret, verifySecret } = require('../../src/lib/hashing');

describe('hashing', () => {
  test('a hashed secret verifies correctly', async () => {
    const hash = await hashSecret('1234');
    await expect(verifySecret('1234', hash)).resolves.toBe(true);
  });

  test('the wrong secret does not verify', async () => {
    const hash = await hashSecret('1234');
    await expect(verifySecret('9999', hash)).resolves.toBe(false);
  });

  test('the hash is not the plaintext value', async () => {
    const hash = await hashSecret('20112988sk!');
    expect(hash).not.toBe('20112988sk!');
  });
});
