import readline from 'readline/promises';

const target = process.argv[2] || 'dev';
const dbName = target === 'prod' ? 'pstbg3shwavep' : 'pstbg3shwavep-dev';
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\x1b[31m%s\x1b[0m', `⚠️  WARNING: You are about to DESTROY all data in the ${target.toUpperCase()} database (${dbName})!`);

const confirmationString = `RESET ${target.toUpperCase()}`;
const answer = await rl.question(`Please type "${confirmationString}" to confirm: `);

if (answer === confirmationString) {
  console.log('✅ Confirmation accepted. Proceeding...');
  process.exit(0);
} else {
  console.log('❌ Confirmation failed. Aborting.');
  process.exit(1);
}
