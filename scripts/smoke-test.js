import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const port = 18080 + (process.pid % 1000);
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'personal-ai-hub-smoke-'));
const logs = [];
let exited = false;
let exitInfo = null;
const child = spawn(process.execPath, ['index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    SERVICE_NAME: 'personal-ai-hub-smoke',
    AI_HUB_ADMIN_PASSWORD: 'smoke-test-only-password',
    ENABLE_MANAGED_OLLAMA: '0',
    NODE_ENV: 'test'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    logs.push(chunk);
    if (logs.join('').length > 16000) logs.splice(0, Math.max(0, logs.length - 100));
  });
}
child.on('exit', (code, signal) => {
  exited = true;
  exitInfo = { code, signal };
});

let failure = null;
try {
  const deadline = Date.now() + 12000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Server process exited early: ${JSON.stringify(exitInfo)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000)
      });
      if (response.ok) {
        const body = await response.json();
        if (body.status !== 'healthy') throw new Error(`Unexpected health response: ${JSON.stringify(body)}`);
        healthy = true;
        break;
      }
    } catch (err) {
      if (err?.message?.startsWith('Unexpected health response')) throw err;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!healthy) throw new Error('Server did not return healthy /health within 12 seconds');

  const discovery = await fetch(`http://127.0.0.1:${port}/v1`);
  if (!discovery.ok) throw new Error(`/v1 discovery returned HTTP ${discovery.status}`);
  const json = await discovery.json();
  if (!json.openaiCompatible || !json.endpoints?.chat) {
    throw new Error(`Unexpected /v1 discovery payload: ${JSON.stringify(json)}`);
  }
  console.log('PASS startup smoke test: /health and /v1 discovery');
} catch (err) {
  failure = err;
  console.error('FAIL startup smoke test:', err?.stack || err);
  console.error('Server output:\n' + logs.join(''));
} finally {
  if (!exited) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 1500))
    ]);
    if (!exited) child.kill('SIGKILL');
  }
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
if (failure) process.exitCode = 1;
