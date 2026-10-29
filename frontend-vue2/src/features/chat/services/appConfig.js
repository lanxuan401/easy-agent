// ── 应用级常量（原 src/config.js 已移除，直接定义在组件内）────────────
// 应用名称与首页欢迎语；后端 /agent/auth/config 返回的 app_welcome_title 仍可在运行期覆盖
export const APP_TITLE = 'Easy Agent'
export const APP_WELCOME_TITLE = `${APP_TITLE}，让工作化繁为简`
// 登录页开关：true 显示登录 / 注册页；false 不显示，改走门户免密登录。
// 构建期环境变量 VUE_APP_LOGIN_PAGE_ENABLED=false 可关闭（生产门户场景），
// 未配置默认开启 —— 本地/联调可用登录页切换用户。
export const LOGIN_PAGE_ENABLED = process.env.VUE_APP_LOGIN_PAGE_ENABLED !== 'false'
// 免密登录开关：仅在「登录页关」时生效 —— 由前端模拟登录用户信息直接免密登录
// （不调用 loadUserProfile，用户资料取自门户共享存储 system:share:*）。
export const PASSWORDLESS_LOGIN_ENABLED = true
//
// 登录方式约定：
//   登录页开（默认）：显示 Welcome 登录 / 注册页；另支持 URL 免密直登 ?username=&user_id=
//   登录页关：门户免密登录；失败 → 「未授权访问」提示

// ── 门户共享存储键（由外部系统写入 localStorage）──────────────────────────
// system:share:loginId        登录账号     → 免密登录接口的 username
// system:share:iamEmpLoginNo  IAM 员工号   → 免密登录接口的 user_id
// system:share:name           用户姓名     → userProfile.username（展示用）
// system:share:bankName       所属机构/银行 → userProfile.organization_id
export const SHARE_KEY_LOGIN_ID = 'system:share:loginId'
export const SHARE_KEY_EMP_NO = 'system:share:iamEmpLoginNo'
export const SHARE_KEY_NAME = 'system:share:name'
export const SHARE_KEY_BANK = 'system:share:bankName'
// 共享存储缺失时的模拟默认值
export const DEFAULT_PASSWORDLESS_USERNAME = 'demo'
export const DEFAULT_PASSWORDLESS_USER_ID = 'demoid'

/** 安全读取 localStorage（隐私模式 / 禁用存储时返回空串） */
export function readShareItem(key) {
  try {
    return localStorage.getItem(key) || ''
  } catch (e) {
    return ''
  }
}

// ── 当前会话视图持久化 ────────────────────────────────────────────
// 刷新后恢复到用户刷新前所在的会话，而不是永远跳到列表第一个。
// 用 '__new__' 记录"新会话首页"（currentSessionId 为 null）这一状态。
export const ACTIVE_SESSION_KEY = 'easy_agent_active_session'
export const NEW_SESSION_MARK = '__new__'

// ── 流式状态持久化（sessionStorage）─────────────────────────────────────
export const STREAM_STATE_KEY = 'easy_agent_stream_state'

