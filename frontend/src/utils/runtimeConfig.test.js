import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'

const script = path.resolve(import.meta.dirname, '../../scripts/generate-runtime-config.sh')
test('runtime config accepts CRLF environment files and stays valid JavaScript', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'easy-runtime-'))
  try {
    writeFileSync(path.join(root, '.env.dev'), 'VITE_API_BASE_URL="http://localhost:8080"\r\n')
    const result = spawnSync('bash', [script], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const context = { window: {} }
    runInNewContext(readFileSync(path.join(root, 'dist/runtime-config.js'), 'utf8'), context)
    assert.equal(context.window.__RUNTIME_CONFIG__.ENV_CONFIG.dev.API_BASE_URL, 'http://localhost:8080')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
