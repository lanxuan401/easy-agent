import { compactionAttempt, compactionResult } from '../../../shared/utils/compactionView.js'
import { ref, reactive, computed } from 'vue'
import { compactSessionContext } from '../../../api/chat.js'
import { compactionDisabledReason } from '../../../shared/utils/contextCommands.js'

export function useContextCompaction({ currentSessionId, sessionLoading, messages, isStreaming, pendingApproval, selectedModel }) {
  const contextCompactionEnabled = ref(false)
  const compactingSessions = reactive(new Set())
  const records = reactive({})
  const compactionRecords = computed(() => records[currentSessionId.value] || [])
  const isCompacting = computed(() => compactingSessions.has(currentSessionId.value))
  const compactDisabledReason = computed(() => compactionDisabledReason({
    busy: isCompacting.value, loading: sessionLoading.value, sessionId: currentSessionId.value,
    hasHistory: messages.value.length > 0, streaming: isStreaming.value,
    pending: !!pendingApproval.value || messages.value.some(m => m.pending_approval || (m.blocks || []).some(b => b.approval_status === 'pending')),
    supported: contextCompactionEnabled.value,
  }))
  async function handleCompactContext() {
    if (compactDisabledReason.value) return
    const sessionId = currentSessionId.value
    compactingSessions.add(sessionId)
    const attempt = compactionAttempt(messages.value)
    records[sessionId] = [...(records[sessionId] || []), attempt]
    const finish = (result, error) => {
      records[sessionId] = records[sessionId].map(record => record.id === attempt.id ? compactionResult(attempt, result, error) : record)
    }
    try {
      finish(await compactSessionContext(sessionId, selectedModel.value))
    } catch (error) {
      finish(null, error)
    } finally { compactingSessions.delete(sessionId) }
  }
  return { compactionRecords, contextCompactionEnabled, isCompacting, compactDisabledReason, handleCompactContext }
}
