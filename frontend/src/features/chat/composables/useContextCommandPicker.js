import { computed } from 'vue'
import { commandOptions, removeActiveSlash } from '../../../shared/utils/contextCommands.js'

export function useContextCommandPicker({ props, emit, skillQuery, skillOptions, skillPickerOpen, textareaRef, message, closeSkillPicker, selectSkill, replaceTextWithCaret }) {
  const filteredSkills = computed(() => {
    const q = skillQuery.value.trim().toLowerCase()
    if (!q) return skillOptions.value
    const byName = skillOptions.value.filter(s =>
      (s.dir_name || '').toLowerCase().includes(q) ||
      (s.name || '').toLowerCase().includes(q)
    )
    if (byName.length > 0) return byName
    return skillOptions.value.filter(s => (s.description || '').toLowerCase().includes(q))
  })

  const pickerOptions = computed(() => [...commandOptions(skillQuery.value), ...filteredSkills.value.map(skill => ({ ...skill, type: 'skill' }))])

  async function selectPickerOption(option) {
    if (!skillPickerOpen.value) return
    if (option.type !== 'command') return selectSkill(option)
    if (props.compactDisabledReason) return
    const ta = textareaRef.value
    const base = ta ? ta.value : message.value
    const next = removeActiveSlash(base, ta ? ta.selectionStart : base.length)
    if (!next) return
    closeSkillPicker()
    emit('compact')
    await replaceTextWithCaret(next)
  }

  return { pickerOptions, selectPickerOption, filteredSkills }
}
