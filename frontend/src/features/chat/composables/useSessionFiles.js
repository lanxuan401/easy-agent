import { onUnmounted } from 'vue'
import { getSessionGeneratedFiles } from '../../../api/files.js'

export function useSessionFiles(currentSessionId, currentSessionHasFiles) {
  let filesCheckTimer = null
  async function refreshSessionFiles(sessionId = null, delayMs = 0) {
    const targetId = sessionId || currentSessionId.value
    if (!targetId) {
      currentSessionHasFiles.value = false
      return false
    }
    if (filesCheckTimer) {
      clearTimeout(filesCheckTimer)
      filesCheckTimer = null
    }
    const doCheck = async () => {
      try {
        const files = await getSessionGeneratedFiles(targetId)
        const hasFiles = Array.isArray(files) && files.length > 0
        if (currentSessionId.value === targetId) {
          currentSessionHasFiles.value = hasFiles
        }
        console.log('[Files] Session', targetId, 'has files:', hasFiles, 'count:', files?.length)
        return currentSessionId.value === targetId && hasFiles
      } catch (e) {
        console.error('[Files] 检查会话文件失败:', e)
        if (currentSessionId.value === targetId) {
          currentSessionHasFiles.value = false
        }
        return false
      }
    }
    if (delayMs > 0) {
      return await new Promise((resolve) => {
        filesCheckTimer = setTimeout(() => {
          doCheck().then(resolve).catch(resolve)
        }, delayMs)
      })
    } else {
      return await doCheck()
    }
  }

  onUnmounted(() => { if (filesCheckTimer) clearTimeout(filesCheckTimer) })
  return { refreshSessionFiles }
}
