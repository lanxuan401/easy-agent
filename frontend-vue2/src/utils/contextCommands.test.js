import test from 'node:test'
import assert from 'node:assert/strict'
import { commandOptions, removeActiveSlash, compactionDisabledReason } from '../shared/utils/contextCommands.js'

test('compact is available independently of skills and matches English/Chinese queries', () => {
  for (const query of ['', 'com', 'COM', '压缩']) assert.equal(commandOptions(query)[0].type, 'command')
  assert.deepEqual(commandOptions('pdf'), [])
})
test('only the active slash query is removed; draft prefix and suffix survive', () => {
  assert.deepEqual(removeActiveSlash('草稿 /com 后续', 7), { text: '草稿  后续', caret: 3 })
  assert.deepEqual(removeActiveSlash('/压缩', 3), { text: '', caret: 0 })
  assert.equal(removeActiveSlash('plain text', 10), null)
})
test('session conditions produce an explicit disabled reason', () => {
  const ready = { sessionId: 's', hasHistory: true, supported: true }
  assert.equal(compactionDisabledReason(ready), '')
  for (const patch of [{busy:true},{loading:true},{sessionId:null},{hasHistory:false},{streaming:true},{pending:true},{supported:false}]) {
    assert.ok(compactionDisabledReason({...ready, ...patch}))
  }
})
