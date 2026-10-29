import test from 'node:test'
import assert from 'node:assert/strict'
import { compactionAttempt, compactionResult, compactionRecords, compactionUsage } from '../shared/utils/compactionView.js'

const record = { id: 'c1', after_message_index: 1, model: 'selected', context_tokens: 2000, context_length: 20000 }
const messages = [{ role: 'user' }, { role: 'assistant', context_compactions: [record] }]
const usage = { context_tokens: 9000, input_tokens: 90000, output_tokens: 500, context_length: 20000 }

test('refresh/local records deduplicate; compact updates ring without changing real cumulative usage', () => {
  const records = compactionRecords(messages, [record])
  assert.equal(records.length, 1)
  const shown = compactionUsage(messages, usage, records, 'selected')
  assert.equal(shown.context_tokens, 2000)
  assert.equal(shown.context_estimated, true)
  assert.equal(shown.input_tokens, 90000)
  assert.equal(usage.context_tokens, 9000)
})

test('next reply and different selected model use real usage instead of stale estimate', () => {
  const sending = [...messages, { role: 'user' }, { role: 'assistant', loading: true }]
  const completed = [...sending.slice(0, -1), { role: 'assistant', loading: false, usage: { input_tokens: 1 } }]
  assert.equal(compactionUsage(sending, usage, [record], 'selected').context_tokens, record.context_tokens)
  assert.equal(compactionUsage(sending, usage, [record], 'selected').context_estimated, true)
  assert.equal(compactionUsage(completed, usage, [record], 'selected').context_estimated, false)
  assert.equal(compactionUsage(messages, usage, [record], 'other-model').context_tokens, 9000)
  assert.equal(compactionUsage([], usage, [], 'selected').context_estimated, false)
})

test('running, skipped and failed attempts stay anchored after later messages arrive', () => {
  const displayed = [...messages]
  const attempt = compactionAttempt(displayed)
  displayed.push({ role: 'user' }, { role: 'assistant' })
  for (const result of [attempt, compactionResult(attempt, { status: 'skipped', message: '当前无需压缩' }),
    compactionResult(attempt, null, new Error('failed'))]) {
    assert.equal(result.after_message_index, 1)
  }
  assert.equal(attempt.message, '正在压缩...')
  const saved = { ...record, status: 'skipped' }
  assert.deepEqual(compactionResult(attempt, { compaction: saved }), saved)
})

test('skipped refreshes usage; running and errors retain latest valid measurement', () => {
  const skipped = { ...record, id: 'c2', context_tokens: 0, status: 'skipped' }
  const attempt = compactionAttempt(messages)
  const failed = compactionResult(attempt, null, new Error('failed'))
  const shown = compactionUsage(messages, usage, [record, skipped, attempt, failed], 'selected')
  assert.equal(shown.context_tokens, 0)
  assert.equal(shown.input_tokens, usage.input_tokens)
  assert.equal(shown.context_estimated, true)
})
