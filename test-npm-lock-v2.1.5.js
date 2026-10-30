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

test('ms is published 2.1.3 (not phantom 2.1.4)', () => {
  assert.equal(pkg.overrides.ms, '2.1.3');
  const ms = lock.packages['node_modules/ms'];
  assert.ok(ms, 'ms package locked');
  assert.equal(ms.version, '2.1.3');
  assert.ok(ms.resolved.includes('ms-2.1.3.tgz'));
  assert.ok(!Object.values(lock.packages).some(x => String(x.resolved || '').endsWith('/ms-2.1.4.tgz')));
});

test('mime-types is published 2.1.35 (not 2.1.44/45)', () => {
  assert.equal(pkg.overrides['mime-types'], '2.1.35');
  const mt = lock.packages['node_modules/mime-types'];
  assert.ok(mt, 'mime-types package locked');
  assert.equal(mt.version, '2.1.35');
  assert.ok(mt.resolved.includes('mime-types-2.1.35.tgz'));
  const dump = JSON.stringify(lock);
  assert.ok(!dump.includes('2.1.44'));
  assert.ok(!dump.includes('2.1.45'));
});

test('express is locked', () => {
  const ex = lock.packages['node_modules/express'];
  assert.ok(ex);
  assert.ok(ex.version.startsWith('4.'));
});
