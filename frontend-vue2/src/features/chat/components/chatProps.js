const APP_WELCOME_TITLE = 'Easy Agent，让工作化繁为简'

export default {
    isCompacting: { type: Boolean, default: false },
    compactDisabledReason: { type: String, default: '' },
    compactionRecords: { type: Array, default: () => [] },

  messages: {
    type: Array,
    default: () => []
  },
  sessionLoading: {
    type: Boolean,
    default: false
  },
  currentSessionId: {
    type: String,
    default: null
  },
  sessionCreatedAt: {
    type: String,
    default: null
  },
  isStreaming: {
    type: Boolean,
    default: false
  },
  scrollTrigger: {
    type: Number,
    default: 0
  },
  sessionUsage: {
    type: Object,
    default: () => ({ input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 })
  },
  sessionDuration: {
    type: Number,
    default: 0
  },
  iterationCount: {
    type: Number,
    default: 0
  },
  todos: {
    type: Array,
    default: () => []
  },
  presetQuestions: {
    type: Array,
    default: () => []
  },
  workspaceExpanded: {
    type: Boolean,
    default: false
  },
  sidebarCollapsed: {
    type: Boolean,
    default: false
  },
  models: {
    type: Array,
    default: () => []
  },
  selectedModel: {
    type: String,
    default: null
  },
  welcomeTitle: {
    type: String,
    default: APP_WELCOME_TITLE
  },
  // main：主页面对话；sidebar：AI 侧边栏（窄栏布局，输入框始终贴底，不展示工作区入口）
  variant: {
    type: String,
    default: 'main'
  },
  // 输入草稿的 sessionStorage key：侧边栏与主页面各存一份，互不覆盖
  draftKey: {
    type: String,
    default: 'easy_agent_input_draft'
  },
  // 当前会话选中的专家 Agent（{export_agent_id, export_name_cn} 或 null）。
  // 非空时输入框工具栏显示专家胶囊，且本会话消息走 /agent/chat/stream（带 expert_agent_id）。
  activeExpert: {
    type: Object,
    default: null
  },
  // 外部预填的问题（专家详情弹窗点「专家帮你做」示例）：透传给 ChatInput，
  // 由其写入输入框后通过 expert-prompt-applied 通知 App 清空。
  expertPrompt: {
    type: String,
    default: ''
  },
  showManageEntry: {
    type: Boolean,
    default: true
  }
}
