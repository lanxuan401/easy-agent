import { watch } from 'vue'
import { enhancePrompt } from '../../../api/promptEnhancement.js'
import { createPromptEnhancer, enhancementDraft } from '../../../shared/utils/promptEnhancement.js'
import { skillSegments, insertSkillToken } from '../../../utils/skillPillTokens.js'

export default {
  data: () => ({ enhancement: { busy: false, notice: '' } }),
  computed: {
    canEnhance() {
      return !this.disabled && !this.isStreaming && !this.enhancement.busy &&
        !!enhancementDraft(this.message, skillSegments(this.message, this.tokenMap)).body
    },
  },
  created() {
    this._promptEnhancer = createPromptEnhancer({
      read: () => ({ text: this.message, scope: this.sessionId + ':' + this.draftKey,
        blocked: this.disabled || this.isStreaming,
        ...enhancementDraft(this.message, skillSegments(this.message, this.tokenMap)) }),
      write: text => { this.message = text; this.$nextTick(() => { this.autoResize(); this.focusInput() }) },
      request: enhancePrompt,
      restoreTokens: (body, tokens) => tokens.reduceRight((text, token) => insertSkillToken(text, 0, token).text, body),
      publish: state => Object.assign(this.enhancement, state),
    })
    // Synchronous invalidation also catches edit-then-revert within a Vue update batch.
    this._stopEnhancementWatch = watch(
      () => [this.message, this.sessionId, this.draftKey, this.disabled, this.isStreaming,
        JSON.stringify(this.activeExpert), JSON.stringify(this.preselectedSkillDirs),
        this.expertPrompt, this.tokenMap],
      () => this._promptEnhancer.invalidate(), { flush: 'sync' }
    )
  },
  beforeDestroy() {
    this._promptEnhancer.dispose()
    this._stopEnhancementWatch()
  },
  methods: {
    enhanceDraft() { return this._promptEnhancer.enhance() },
  },
}
