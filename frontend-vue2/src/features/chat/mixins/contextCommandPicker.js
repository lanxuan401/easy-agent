import { commandOptions, removeActiveSlash } from '../../../shared/utils/contextCommands.js'

export default {
  computed: {
    filteredSkills() {
      const q = this.skillQuery.trim().toLowerCase()
      if (!q) return this.skillOptions
      const byName = this.skillOptions.filter(s =>
        (s.dir_name || '').toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q)
      )
      if (byName.length > 0) return byName
      return this.skillOptions.filter(s => (s.description || '').toLowerCase().includes(q))
    },

    pickerOptions() {
      return [...commandOptions(this.skillQuery), ...this.filteredSkills.map(skill => ({ ...skill, type: 'skill' }))]
    },
  },
  methods: {
    async selectPickerOption(option) {
      if (!this.skillPickerOpen) return
      if (option.type !== 'command') return this.selectSkill(option)
      if (this.compactDisabledReason) return
      const ta = this.$refs.textareaRef
      const base = ta ? ta.value : this.message
      const next = removeActiveSlash(base, ta ? ta.selectionStart : base.length)
      if (!next) return
      this.closeSkillPicker()
      this.$emit('compact')
      await this.replaceTextWithCaret(next)
    },

  },
}
