#!/usr/bin/env node

require('../dist/cli.js').main().catch(error => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 2;
});
