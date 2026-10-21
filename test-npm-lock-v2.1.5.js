import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)));
const lock = JSON.parse(fs.readFileSync(new URL('./package-lock.json', import.meta.url)));
test('release version is synchronized', () => {
  assert.equal(pkg.version, '2.1.5');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});
test('npm overrides unavailable ms 2.1.4 with published 2.1.3', () => {
  assert.equal(pkg.overrides.ms, '2.1.3');
  const send = lock.packages['node_modules/send'];
  const nestedMs = lock.packages['node_modules/send/node_modules/ms'];
  assert.equal(send.dependencies.ms, '2.1.3');
  assert.equal(nestedMs.version, '2.1.3');
  assert.equal(nestedMs.resolved, 'https://registry.npmjs.org/ms/-/ms-2.1.3.tgz');
  assert.ok(!Object.values(lock.packages).some(x => x.resolved?.endsWith('/ms-2.1.4.tgz')));
});
