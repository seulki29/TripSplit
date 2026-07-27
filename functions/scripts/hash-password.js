// Usage: node scripts/hash-password.js   (run from the functions/ directory)
// Type the password, press Enter. Prints the bcrypt hash to paste into
// `firebase functions:secrets:set SUPERADMIN_PASSWORD_HASH`.
const readline = require('readline');
const bcrypt = require('bcryptjs');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Password: ', async (password) => {
  rl.close();
  if (!password) {
    console.error('Empty password — nothing hashed.');
    process.exit(1);
  }
  console.log(await bcrypt.hash(password, 10));
});
