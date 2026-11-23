import assert from 'node:assert/strict';
import { publishFixtureLayout } from './worker-helper.mjs';
await fetch(process.argv[2]);
assert.equal((await publishFixtureLayout(process.argv[2])).status, 200);
