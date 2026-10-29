import { requestJson } from './request.js'

export async function enhancePrompt(prompt, signal) {
  try {
    return await requestJson({
      url: '/agent/prompts/enhance', method: 'POST', data: { prompt },
      signal, timeout: 125000, // Greater than the server's configurable 120s ceiling.
    }, '提示词增强失败，请重试')
  } catch (error) {
    if (error.response && error.response.status === 422) {
      error.message = '请输入有效提示词，或缩短输入内容'
    }
    if (error.code === 'ECONNABORTED') error.message = '提示词增强超时，请重试'
    throw error
  }
}
