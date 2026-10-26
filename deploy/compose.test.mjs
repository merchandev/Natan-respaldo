import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Emula la carpeta de ejecución de Hostinger: solo compose.yaml, sin .env
// ni deploy/Caddyfile. La construcción de la imagen se prueba en el workflow.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function config(overrides = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'natan-compose-'));
  try {
    fs.copyFileSync(path.join(root, 'compose.yaml'), path.join(temp, 'compose.yaml'));
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(COMPOSE_|NATAN_|SUPABASE_|FRONTEND_SUPABASE_|BNC_|D3XD_)/.test(key)) delete env[key];
    }
    return JSON.parse(execFileSync('docker', ['compose', 'config', '--format', 'json'], { cwd: temp, env: { ...env, ...overrides }, encoding: 'utf8' }));
  } finally {
    const resolved = path.resolve(temp);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('natan-compose-')) throw new Error('Directorio temporal fuera de alcance');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
test('Arranca sin archivos externos y solo publica 18091', () => {
  const result = config();
  assert.equal(result.name, 'natan-respaldo');
  assert.deepEqual(Object.keys(result.services), ['app']);
  const app = result.services.app;
  assert.equal(app.ports.length, 1);
  assert.equal(String(app.ports[0].published), '18091');
  assert.equal(app.ports[0].target, 3000);
  assert.equal(app.ports[0].host_ip, '0.0.0.0');
  assert.equal(app.ports[0].protocol, 'tcp');
  assert.equal(app.volumes, undefined);
  assert.equal(app.env_file, undefined);
  assert.equal(app.container_name, undefined);
  assert.equal(app.network_mode, undefined);
  assert.equal(app.privileged, undefined);
  assert.equal(app.labels['traefik.enable'], 'false');
  assert.deepEqual(app.networks, { default: null });
  assert.equal(result.networks.default.name, 'natan-respaldo_default');
  assert.equal(result.networks.default.external, undefined);
  assert.deepEqual(result.networks.default.ipam || {}, {});
  assert.equal(result.volumes, undefined);
  assert.equal(Number(app.mem_limit), 536870912);
  assert.equal(Number(app.cpus), 1);
  assert.equal(app.pids_limit, 100);
});
test('Permite cambiar puerto y variables desde Hostinger', () => {
  const result = config({ NATAN_HTTP_PORT: '18095', NATAN_BIND_ADDRESS: '127.0.0.1', SUPABASE_URL: 'https://example.invalid', D3XD_API_TOKEN: 'test-only' });
  const app = result.services.app;
  assert.equal(String(app.ports[0].published), '18095');
  assert.equal(app.ports[0].host_ip, '127.0.0.1');
  assert.equal(app.environment.SUPABASE_URL, 'https://example.invalid');
  assert.equal(app.environment.D3XD_API_TOKEN, 'test-only');
  assert.equal(app.environment.PORT, '3000');
});
