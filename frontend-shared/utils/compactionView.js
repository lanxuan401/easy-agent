/** 展示记录独立于聊天消息；服务端持久记录与本机刚完成记录按 id 去重。 */
export function compactionRecords(messages, local = []) {
  const records = new Map()
  for (const record of [...messages.flatMap(m => m.context_compactions || []), ...local]) {
    if (record?.id) records.set(record.id, record)
  }
  return [...records.values()]
}

export function compactionUsage(messages, usage, records, model) {
  const last = records.filter(record => Number.isFinite(record.context_tokens)).at(-1)
  const hasLaterCompletedReply = last && messages.some((message, index) =>
    index > last.after_message_index && message.role === 'assistant' && message.usage
  )
  if (!last || last.after_message_index > messages.length - 1 || hasLaterCompletedReply || (last.model && last.model !== model)) {
    return { ...usage, context_estimated: false }
  }
  return { ...usage, context_tokens: last.context_tokens, context_length: last.context_length, context_estimated: true }
}


export function compactionAttempt(messages) {
  return { id: `local-${Date.now()}-${Math.random()}`, after_message_index: messages.length - 1,
    status: 'running', message: '正在压缩...' }
}

export function compactionResult(attempt, result, error) {
  if (error) return { ...attempt, status: 'error', message: error.message || '上下文压缩失败，请重试' }
  return result.compaction || { ...attempt, status: result.status, message: result.message }
}
