import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, computed } from 'vue'
import { createStreamChunkHandler } from './useStreamChunks.js'

// 执行 App 的真实建会话、发送与会话路由函数，避免只测输入框时漏掉父级状态归属。
// 只替换 HTTP/页面副作用；SSE 使用真实处理器，不复制其状态机。
const { descriptor } = parse(readFileSync(new URL('../../../App.vue', import.meta.url), 'utf8'))
const { scriptSetupAst } = compileScript(descriptor, { id: 'session-ownership-test' })
const names = [
  'ensureCurrentSession', 'handleSendMessage', 'saveCurrentSessionState',
  'ensureSessionState', 'buildStreamState', 'runInSession', 'syncSessionFromServer',
]
const functions = names.map(name => {
  const node = scriptSetupAst.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, `App 应提供 ${name}`)
  return descriptor.scriptSetup.content.slice(node.start, node.end)
}).join('\n')

function makeHarness(reply = '附件校验通过') {
  const streaming = new Set()
  const state = {
    currentSessionId: ref(null), loadedSessionId: ref(null), messages: ref([]),
    sessions: ref([]), sessionStates: ref({}), currentTodos: ref([]),
    sessionUsage: ref({ context_tokens: 0, context_length: 65536 }),
    sessionDuration: ref(0), iterationCount: ref(0),
    currentAbortController: ref(null), streamingAssistantId: ref(null),
    pendingApproval: ref(null), attachedStreamingSessions: ref({}), error: ref(null),
    userProfile: ref({ username: 'test' }), selectedExpert: ref(null),
    selectedModel: ref('test-model'), isCompacting: ref(false),
    scrollTrigger: ref(0),
  }
  state.isStreaming = computed(() => streaming.has(state.currentSessionId.value))
  let receive, complete
  const api = runInNewContext(`${functions}\n({ ensureCurrentSession, handleSendMessage, saveCurrentSessionState })`, {
    ...state, AbortController, createStreamChunkHandler,
    createSession: async () => ({ session_id: 'attachment-session', title: '新会话' }),
    sendMessage: (_sid, _message, onChunk) => {
      receive = onChunk
      return new Promise(resolve => { complete = resolve })
    },
    markStreaming: sid => { if (sid) streaming.add(sid) },
    unmarkStreaming: sid => streaming.delete(sid),
    chatBus: { emit() {} }, syncPendingApprovalFlag() {}, applyApprovalRequests() {},
    loadSessions: async () => {}, expandWorkspaceAfterSessionCompletion: async () => {},
    getChatHistory: async () => ({
      messages: [{ role: 'user', content: '问题' }, { role: 'assistant', content: reply, loading: false }],
      usage: { input_tokens: 123, context_tokens: 123 },
    }),
    isSessionStreaming: sid => streaming.has(sid), syncExpertChipFromMessages() {},
    parseMCPResult: value => value,
  })
  return { state, api, receive: event => receive(event), complete: () => complete() }
}

const file = { filename: 'note.txt', file_path: '/workspace/uploads/note.txt', size: 10, file: { type: 'text/plain' } }

test('新会话附件预建后，正文和 done 更新当前页面，无需刷新', async () => {
  const h = makeHarness()
  await h.api.ensureCurrentSession()
  const sending = h.api.handleSendMessage('读取附件', [file])
  h.receive({ type: 'start', session_id: 'attachment-session' })
  h.receive({ type: 'content', content: '附件校验通过' })
  assert.match(JSON.stringify(h.state.messages.value), /附件校验通过/, '增量回复应进入当前展示消息')
  h.receive({ type: 'done', usage: { context_tokens: 123, input_tokens: 123, step_count: 1 } })
  assert.equal(h.state.messages.value[1].content, '附件校验通过')
  assert.equal(h.state.messages.value[1].loading, false, 'done 到达即结束等待，不依赖历史回填')
  h.complete()
  await sending
  const assistant = h.state.messages.value.find(message => message.role === 'assistant')
  assert.equal(assistant.content, '附件校验通过')
  assert.equal(assistant.loading, false)
  assert.equal(h.state.currentAbortController.value, null)
  assert.equal(h.state.streamingAssistantId.value, null)
  assert.equal(h.state.sessionUsage.value.context_tokens, 123)
  assert.equal(h.state.isStreaming.value, false)
})

test('无附件的新会话仍由 start 认领并正常结束', async () => {
  const h = makeHarness('普通回复')
  const sending = h.api.handleSendMessage('普通消息')
  h.receive({ type: 'start', session_id: 'plain-session' })
  h.receive({ type: 'content', content: '普通回复' })
  h.receive({ type: 'done' })
  h.complete()
  await sending
  assert.equal(h.state.loadedSessionId.value, 'plain-session')
  assert.equal(h.state.messages.value[1].content, '普通回复')
  assert.equal(h.state.messages.value[1].loading, false)
})

test('附件回复期间切到其他会话，后续事件只更新原会话缓存', async () => {
  const h = makeHarness('第一段第二段')
  await h.api.ensureCurrentSession()
  const sending = h.api.handleSendMessage('读取附件', [file])
  h.receive({ type: 'start', session_id: 'attachment-session' })
  h.receive({ type: 'content', content: '第一段' })
  h.api.saveCurrentSessionState()
  h.state.currentSessionId.value = 'other-session'
  h.state.loadedSessionId.value = 'other-session'
  h.state.messages.value = [{ id: 'other', role: 'assistant', content: '其他会话', loading: false }]
  h.state.sessionUsage.value = { context_tokens: 999 }
  h.receive({ type: 'content', content: '第二段' })
  h.receive({ type: 'done' })
  h.complete()
  await sending
  assert.equal(h.state.currentSessionId.value, 'other-session')
  assert.equal(h.state.loadedSessionId.value, 'other-session')
  assert.equal(h.state.messages.value.length, 1)
  assert.equal(h.state.messages.value[0].content, '其他会话')
  assert.equal(h.state.sessionUsage.value.context_tokens, 999)
  const assistant = h.state.sessionStates.value['attachment-session'].messages.find(message => message.role === 'assistant')
  assert.equal(assistant.content, '第一段第二段')
  assert.equal(assistant.loading, false)
})
