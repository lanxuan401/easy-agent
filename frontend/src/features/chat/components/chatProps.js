import { APP_WELCOME_TITLE } from '../../../config.js'

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
  // 当前会话选中的专家 Agent（{export_agent_id, export_name_cn} 或 null）。
  // 非空时输入框工具栏显示专家胶囊，且本会话消息走 /agent/chat/stream（带 expert_agent_id）。
  activeExpert: {
    type: Object,
    default: null
  },
  // 待回填到输入框的问题（专家详情弹窗点「专家帮你做」示例），写入后由
  // expertPromptApplied 事件通知父组件清空。
  expertPrompt: {
    type: String,
    default: ''
  }
}
