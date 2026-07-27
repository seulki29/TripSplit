// Usage (from the functions/ directory), pipe the hash straight into the
// secret so there is no copy-paste that could corrupt it:
//   node scripts/hash-password.js | npx firebase-tools@14 functions:secrets:set SUPERADMIN_PASSWORD_HASH --data-file - --project sfayw-10d11
// The "Password:" prompt is written to stderr; ONLY the 60-char bcrypt hash
// is written to stdout, so the pipe carries nothing but the hash.
const readline = require('readline');
const bcrypt = require('bcryptjs');

// output -> stderr keeps the prompt off stdout so stdout is hash-only.
const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
rl.question('Password: ', async (password) => {
  rl.close();
  if (!password) {
    process.stderr.write('Empty password — nothing hashed.\n');
    process.exit(1);
  }
  process.stdout.write(await bcrypt.hash(password, 10));
});
