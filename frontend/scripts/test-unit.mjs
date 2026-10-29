import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => {
    const name = path.join(dir, entry.name)
    return entry.isDirectory() ? collect(name) : (name.endsWith('.test.js') ? [name] : [])
  }))
  return nested.flat()
}
const result = spawnSync(process.execPath, ['--test', ...await collect('src')], { stdio: 'inherit' })
process.exit(result.status ?? 1)
