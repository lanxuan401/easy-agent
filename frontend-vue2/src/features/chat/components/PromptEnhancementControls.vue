<template>
  <div :class="mode === 'status' ? '' : 'enhancement-button-wrap'">
      <div v-if="mode === 'status' && state.notice" class="enhancement-status" role="status" aria-live="polite">
        <span>{{ state.notice }}</span>
      </div>
    <template v-if="mode !== 'status'">
          <button type="button" class="action-btn enhance-btn" title="增强提示词"
            aria-label="增强提示词" :aria-busy="state.busy ? 'true' : 'false'"
            :disabled="!canEnhance" @click="$emit('enhance')">
            <svg v-if="state.busy" class="enhance-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3a9 9 0 1 1-9 9" /></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m4 20 12-12 4 4L8 24M14 10l4 4M5 3v6M2 6h6M18 1v4M16 3h4" transform="translate(0 -2)" /></svg>
          </button>
    </template>
  </div>
</template>
<script>
export default {
  props: {
    mode: { type: String, default: 'button' },
    state: { type: Object, required: true },
    canEnhance: { type: Boolean, default: false },
  },
}
</script>
<style scoped>
.enhancement-button-wrap { display: flex; flex-shrink: 0; }
.enhance-btn { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.enhance-btn svg { width: 18px; height: 18px; }
.enhance-btn:hover:not(:disabled) { color: var(--accent-color); background: var(--bg-tertiary); }
.enhance-btn:disabled { opacity: .45; cursor: not-allowed; }
.enhance-btn:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
.enhance-spinner { animation: enhance-spin 1s linear infinite; }
@keyframes enhance-spin { to { transform: rotate(360deg); } }
.enhancement-status { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 4px 16px 8px; font-size: 12px; color: var(--text-secondary); }
@media (prefers-reduced-motion: reduce) { .enhance-spinner { animation: none; } }
</style>
