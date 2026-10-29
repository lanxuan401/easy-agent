import { ref, computed, watch } from 'vue'
import { enhancePrompt } from '../../../api/promptEnhancement.js'
import { createPromptEnhancer, enhancementDraft } from '../../../shared/utils/promptEnhancement.js'
import { skillSegments, insertSkillToken } from '../../../utils/skillPillTokens.js'

export function usePromptEnhancement({ message, tokenMap, preselectedSkillDirs, props, write }) {
  const enhancement = ref({ busy: false, notice: '' })
  const promptEnhancer = createPromptEnhancer({
    read: () => ({ text: message.value, scope: props.sessionId,
      blocked: props.disabled || props.isStreaming,
      ...enhancementDraft(message.value, skillSegments(message.value, tokenMap.value)) }),
    write,
    request: enhancePrompt,
    restoreTokens: (body, tokens) => tokens.reduceRight((text, token) => insertSkillToken(text, 0, token).text, body),
    publish: state => Object.assign(enhancement.value, state),
  })
  const canEnhance = computed(() => !props.disabled && !props.isStreaming && !enhancement.value.busy &&
    !!enhancementDraft(message.value, skillSegments(message.value, tokenMap.value)).body)
  watch(() => [message.value, props.sessionId, props.disabled, props.isStreaming,
    JSON.stringify(props.activeExpert), JSON.stringify([...preselectedSkillDirs.value]), props.prefillText, tokenMap.value],
    () => promptEnhancer.invalidate(), { flush: 'sync' })
  function enhanceDraft() { return promptEnhancer.enhance() }

  return { enhancement, canEnhance, enhanceDraft, promptEnhancer }
}
