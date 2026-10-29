export const PREFS_KEY = 'easy_agent_ai_sidebar_prefs'
export const PAGE_SESSIONS_KEY = 'easy_agent_ai_page_sessions'
export const DEFAULT_WIDTH = 440
export const MIN_WIDTH = 340
export const RAIL_WIDTH = 52
// 小于该宽度的视口强制悬浮全宽显示
export const NARROW_VIEWPORT = 768
export const MAX_PAGE_SESSIONS = 20
export const QUOTE_MAX = 32000
export const DEFAULT_FEATURES = {
  launcher: true,
  selectionAsk: true,
  shortcut: true,
  dock: true,
  openInMain: true,
}

export function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (_) {
    return fallback
  }
}

export function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch (_) { /* 存储不可用时忽略 */ }
}

