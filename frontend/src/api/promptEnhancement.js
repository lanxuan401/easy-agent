import { API_BASE_URL } from '../config.js'
import { authFetch } from './auth.js'

export async function enhancePrompt(prompt, signal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal.aborted) abort()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 125000)
  try {
    const response = await authFetch(`${API_BASE_URL}/agent/prompts/enhance`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }), signal: controller.signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = response.status === 422 ? '请输入有效提示词，或缩短输入内容' : data.detail
      throw new Error(typeof detail === 'string' ? detail : '提示词增强失败，请重试')
    }
    return data
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new Error('提示词增强超时，请重试')
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
