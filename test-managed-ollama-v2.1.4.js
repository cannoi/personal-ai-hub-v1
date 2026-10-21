import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';

const read = (p) => fs.readFile(new URL(p, import.meta.url), 'utf8');

test('production Docker image installs managed Ollama by default and fails hard if install fails', async () => {
  const dockerfile = await read('./Dockerfile');
  assert.match(dockerfile, /ARG WITH_OLLAMA=1/);
  assert.match(dockerfile, /ENABLE_MANAGED_OLLAMA=1/);
  assert.match(dockerfile, /curl --retry 3[\s\S]*-fsSL/);
  assert.match(dockerfile, /test -x \/usr\/local\/bin\/ollama/);
  assert.doesNotMatch(dockerfile, /Ollama download failed[^\n]*exit 0/);
  assert.match(dockerfile, /unsupported architecture[\s\S]*exit 1/);
});

test('SoloHost compose enables managed Ollama without publishing its private port', async () => {
  const compose = await read('./docker-compose.yml');
  assert.match(compose, /ENABLE_MANAGED_OLLAMA: "1"/);
  assert.match(compose, /personal-ai-ollama-data:\/app\/ollama-data/);
  assert.doesNotMatch(compose, /- "(?:127\.0\.0\.1:)?11434:11434"/);
});

test('application defaults managed Ollama on but honors an explicit cloud-only override', async () => {
  const index = await read('./index.js');
  assert.match(index, /process\.env\.ENABLE_MANAGED_OLLAMA \?\? '1'/);
  assert.match(index, /ensureOllama\(\)/);
  assert.match(index, /ENABLE_MANAGED_OLLAMA=0/);
});

test('ensureOllama recognizes a reachable local Ollama API without spawning a second daemon', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
    } else {
      res.writeHead(404); res.end('{}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  process.env.OLLAMA_HOST = `127.0.0.1:${port}`;
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.OLLAMA_MODELS = '/tmp/pah-test-ollama-models';
  process.env.DATA_DIR = '/tmp/pah-test-ollama-data';
  try {
    const { ensureOllama } = await import('./start-ollama.js?test=' + port);
    const result = await ensureOllama();
    assert.equal(result.ok, true);
    assert.equal(result.started, false);
    assert.equal(result.base, `http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
