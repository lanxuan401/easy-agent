/** Remove only recognized skill spans, preserving body whitespace and code. */
export function enhancementDraft(text, segments) {
  let body = ''
  let end = 0
  const tokens = []
  const seen = new Set()
  for (const segment of segments) {
    body += text.slice(end, segment.start)
    end = segment.end
    if (!seen.has(segment.dirName)) {
      seen.add(segment.dirName)
      tokens.push(segment.token)
    }
  }
  return { body: (body + text.slice(end)).trim(), tokens }
}

/** Framework independent ownership/revision guard shared by both Vue baselines. */
export function createPromptEnhancer({ read, write, request, restoreTokens, publish }) {
  let revision = 0
  let active = null
  let applying = false
  let disposed = false
  const update = (busy = false, notice = '') => publish({ busy, notice })
  function invalidate() {
    if (applying) return
    revision += 1
    const previous = active
    active = null
    if (previous) previous.controller.abort()
    update()
  }
  function replace(text) {
    applying = true
    try { write(text) } finally { applying = false }
  }
  async function enhance() {
    const snapshot = read()
    if (disposed || active || snapshot.blocked || !snapshot.body.trim()) return
    const ticket = { revision, controller: new AbortController(), snapshot }
    active = ticket
    update(true)
    const current = () => !disposed && active === ticket && revision === ticket.revision &&
      !read().blocked && read().scope === snapshot.scope && read().text === snapshot.text
    try {
      const response = await request(snapshot.body, ticket.controller.signal)
      if (!current()) return
      if (typeof response?.enhanced_prompt !== 'string' || !response.enhanced_prompt.trim()) {
        throw new Error('提示词增强返回内容无效，请重试')
      }
      const enhanced = restoreTokens(response.enhanced_prompt.trim(), snapshot.tokens)
      replace(enhanced)
      update(true)
    } catch (error) {
      if (!current() || ticket.controller.signal.aborted) return
      update(true, error.message || '提示词增强失败，请重试')
    } finally {
      // An obsolete response must never stop a newer request's spinner.
      if (active === ticket) {
        active = null
        publish({ busy: false })
      }
    }
  }
  return {
    enhance, invalidate,
    dispose() { invalidate(); disposed = true },
  }
}
