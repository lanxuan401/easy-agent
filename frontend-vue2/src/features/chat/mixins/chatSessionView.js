import { compactionAttempt, compactionResult } from '../../../shared/utils/compactionView.js'
import { compactionDisabledReason } from '../../../shared/utils/contextCommands.js'
import { compactSessionContext } from '../../../api/chat.js'
import { setReactive } from '../../../utils/reactiveSet.js'
import { chatStore } from '../store/chatStore.js'

/** 主聊天与侧边栏共用的会话视图、压缩状态。 */
export default {
  computed: {
    isCompacting() { return chatStore.compactingSessions.includes(this.currentSessionId) },
    compactionRecords() { return chatStore.compactionRecords[this.currentSessionId] || [] },
    compactDisabledReason() {
      return compactionDisabledReason({ busy: this.isCompacting, loading: this.sessionLoading,
        sessionId: this.currentSessionId, hasHistory: this.messages.length > 0,
        streaming: this.isStreaming, pending: !!this.pendingApproval || this.pendingApprovalSessions.includes(this.currentSessionId),
        supported: chatStore.contextCompactionEnabled })
    },
    sessions: {
      get() { return chatStore.sessions },
      set(v) { chatStore.sessions = v },
    },
    streamingSessions: {
      get() { return chatStore.streamingSessions },
      set(v) { chatStore.streamingSessions = v },
    },
    pendingApprovalSessions: {
      get() { return chatStore.pendingApprovalSessions },
      set(v) { chatStore.pendingApprovalSessions = v },
    },
    lastStreamingSession: {
      get() { return chatStore.lastStreamingSession },
      set(v) { chatStore.lastStreamingSession = v },
    },
    currentSessionCreatedAt() {
      if (!this.currentSessionId) return null
      const session = this.sessions.find(s => s.session_id === this.currentSessionId)
      return session && session.created_at ? session.created_at : null
    },
    // 输入框状态：当前展示的会话正在流式时才显示停止按钮与 token 用量
    isStreaming() {
      return this.isSessionStreaming(this.currentSessionId)
    },
  },
  methods: {
    async handleCompactContext() {
      if (this.compactDisabledReason) return
      const sessionId = this.currentSessionId
      chatStore.compactingSessions.push(sessionId)
      const attempt = compactionAttempt(this.messages)
      setReactive(chatStore.compactionRecords, sessionId, [...(chatStore.compactionRecords[sessionId] || []), attempt])
      const finish = (result, error) => setReactive(chatStore.compactionRecords, sessionId,
        chatStore.compactionRecords[sessionId].map(record => record.id === attempt.id ? compactionResult(attempt, result, error) : record))
      try {
        finish(await compactSessionContext(sessionId, this.selectedModel))
      } catch (error) {
        finish(null, error)
      } finally {
        const index = chatStore.compactingSessions.indexOf(sessionId)
        if (index >= 0) chatStore.compactingSessions.splice(index, 1)
      }
    },
  },
}
