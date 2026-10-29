// ⚠️ 自动生成，请勿直接编辑。
// 源文件：frontend-shared/utils/contextCommands.js
// 同步：npm run sync:shared（frontend-vue2 / frontend 各自目录下执行）
/** 指令检索与禁用原因：两版前端共用，不依赖 Vue。 */
export function commandOptions(query) {
  const q = (query || '').trim().toLowerCase()
  return !q || 'compact'.includes(q) || '压缩'.includes(q)
    ? [{ type: 'command', dir_name: 'compact', name: '压缩 compact', description: '压缩较早对话，保留近期内容' }]
    : []
}

export function removeActiveSlash(text, caret) {
  const match = /(^|\s)(\/[^\s/]*)$/.exec(text.slice(0, caret))
  if (!match) return null
  const start = caret - match[2].length
  return { text: text.slice(0, start) + text.slice(caret), caret: start }
}

export function compactionDisabledReason({ busy, loading, sessionId, hasHistory, streaming, pending, supported }) {
  if (busy) return '正在压缩上下文…'
  if (loading) return '正在加载会话，请稍后重试'
  if (!sessionId || !hasHistory) return '新会话暂无可压缩的历史'
  if (pending) return '当前会话等待审批，请先处理审批'
  if (streaming) return '正在生成回复，请稍后重试'
  if (!supported) return '当前未启用会话级上下文压缩'
  return ''
}
