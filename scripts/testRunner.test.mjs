// Pins the test runner flags. --test-force-exit killed the process before every
// file had reported, so `npm test` totals moved between runs (865 to 977 on one commit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);

test('npm test does not force-exit before all files report', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.doesNotMatch(pkg.scripts.test, /--test-force-exit/);
});

test('CI test step does not force-exit', () => {
  const ci = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
  assert.doesNotMatch(ci, /--test-force-exit/);
});
