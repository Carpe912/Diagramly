<script setup lang="ts">
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Grid2X2,
} from '@lucide/vue';
import type { Alignment } from '../domain/alignment';
defineProps<{ count: number; busy: boolean; managedLane: boolean }>();
const emit = defineEmits<{ align: [mode: Alignment] }>();
const choices = [
  { mode: 'left', label: '左对齐', icon: AlignHorizontalJustifyStart },
  { mode: 'center', label: '水平居中', icon: AlignHorizontalJustifyCenter },
  { mode: 'right', label: '右对齐', icon: AlignHorizontalJustifyEnd },
  { mode: 'top', label: '顶对齐', icon: AlignVerticalJustifyStart },
  { mode: 'middle', label: '垂直居中', icon: AlignVerticalJustifyCenter },
  { mode: 'bottom', label: '底对齐', icon: AlignVerticalJustifyEnd },
] as const;
</script>
<template>
  <section class="property-section alignment-inspector">
    <h3>对齐</h3>
    <div class="alignment-buttons">
      <button
        v-for="choice in choices"
        :key="choice.mode"
        :aria-label="choice.label"
        :title="choice.label"
        :disabled="busy || count < 2 || managedLane"
        @click="emit('align', choice.mode)"
      >
        <component :is="choice.icon" :size="17" />
      </button>
    </div>
    <button
      class="button secondary full-width"
      :disabled="busy || !count || managedLane"
      @click="emit('align', 'grid')"
    >
      <Grid2X2 :size="14" />对齐到网格
    </button>
    <p v-if="managedLane" class="field-help">泳道位置由所属泳池统一管理。</p>
    <p v-else-if="count < 2" class="field-help">按住 Shift 选择多个节点，可进行六方向对齐。</p>
  </section>
</template>
<style scoped>
.alignment-buttons {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 3px;
  margin-bottom: 12px;
}
.alignment-buttons button {
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  color: #7183a0;
}
.alignment-buttons button:hover:not(:disabled) {
  background: #f0f4fa;
}
.alignment-inspector .button {
  font-size: 10px;
}
</style>
