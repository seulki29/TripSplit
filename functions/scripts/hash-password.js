// Hash a superadmin password with bcrypt. Run STANDALONE (no pipe) so the
// interactive password prompt reads from the real console — inside a shell
// pipeline the prompt cannot read your keystrokes and you end up hashing the
// wrong (often empty) string.
//
// Recommended flow (from the functions/ directory):
//   node scripts/hash-password.js newhash.txt          # type password -> writes hash to newhash.txt
//   node scripts/check-password.js newhash.txt          # type SAME password -> must print MATCH
//   npx firebase-tools@14 functions:secrets:set SUPERADMIN_PASSWORD_HASH --data-file newhash.txt --project sfayw-10d11
//
// With no file argument the hash is written to stdout instead.
const fs = require('fs');
const readline = require('readline');
const bcrypt = require('bcryptjs');

const outPath = process.argv[2];

// output -> stderr keeps the prompt off stdout so a redirected stdout is hash-only.
const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
rl.question('Password: ', async (password) => {
  rl.close();
  if (!password) {
    process.stderr.write('Empty password — nothing hashed.\n');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  if (outPath) {
    fs.writeFileSync(outPath, hash, 'utf8');
    process.stderr.write(`Hash written to ${outPath}\n`);
  } else {
    process.stdout.write(hash);
  }
});
