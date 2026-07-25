const bcrypt = require('bcryptjs');

async function hashSecret(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifySecret(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashSecret, verifySecret };
