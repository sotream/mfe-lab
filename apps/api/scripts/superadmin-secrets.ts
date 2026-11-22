// Run locally by the owner: node apps/api/scripts/superadmin-secrets.ts <email>
// Reads the password from stdin (hidden on a terminal, never an argument), then prints the values to
// paste into the production env. Writes nothing to disk and never prints the password.
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/password.ts';
import { base32Encode } from '../src/totp.ts';

const email = process.argv[2];
if (!email?.includes('@')) {
  console.error('usage: node apps/api/scripts/superadmin-secrets.ts <email>  (password on stdin)');
  process.exit(1);
}

async function readPassword(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let data = '';
    for await (const chunk of stdin) data += chunk;
    return data.replace(/\r?\n$/, '');
  }
  process.stderr.write('Password (hidden): ');
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve) => {
    let pw = '';
    stdin.on('data', (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write('\n');
          return resolve(pw);
        }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f') pw = pw.slice(0, -1);
        else pw += c;
      }
    });
  });
}

const password = await readPassword();
if (password.length < 12) {
  console.error('password must be at least 12 characters');
  process.exit(1);
}
const secret = base32Encode(randomBytes(20));
console.log(`SUPERADMIN_EMAIL=${email}`);
console.log(`SUPERADMIN_PASSWORD_HASH=${await hashPassword(password)}`);
console.log(`SUPERADMIN_TOTP_SECRET=${secret}`);
console.log(
  `otpauth://totp/${encodeURIComponent(email)}?secret=${secret}&issuer=mfe-lab&algorithm=SHA1&digits=6&period=30`,
);
