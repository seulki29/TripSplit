// Verify a candidate password against a stored bcrypt hash WITHOUT hitting the
// login throttle. Usage (from the functions/ directory):
//   npx firebase-tools@14 functions:secrets:access SUPERADMIN_PASSWORD_HASH --project sfayw-10d11 | Out-File -Encoding ascii checkhash.txt
//   node scripts/check-password.js checkhash.txt
// Type the password you intend to use; it prints MATCH or NO MATCH. The hash
// is read from the file argument so shell quoting of the '$' characters is a
// non-issue.
const fs = require('fs');
const readline = require('readline');
const bcrypt = require('bcryptjs');

const hashPath = process.argv[2];
if (!hashPath) {
  process.stderr.write('Usage: node scripts/check-password.js <hash-file>\n');
  process.exit(1);
}
const hash = fs.readFileSync(hashPath, 'utf8').trim();

const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
rl.question('Password to check: ', async (password) => {
  rl.close();
  const ok = await bcrypt.compare(password, hash);
  process.stdout.write(ok ? 'MATCH\n' : 'NO MATCH\n');
});
