<script setup lang="ts">
import { Grid2X2 } from '@lucide/vue';
import type { CanvasSettings } from '../domain/model';
defineProps<{ value: CanvasSettings; busy: boolean }>();
const emit = defineEmits<{ change: [patch: Partial<CanvasSettings>] }>();
</script>
<template>
  <details class="canvas-settings" @pointerdown.stop>
    <summary aria-label="画布设置"><Grid2X2 :size="14" />画布设置</summary>
    <div class="canvas-settings-popover">
      <label
        ><span>显示网格</span
        ><input
          type="checkbox"
          aria-label="显示网格"
          :checked="value.grid"
          :disabled="busy"
          @change="emit('change', { grid: ($event.target as HTMLInputElement).checked })"
      /></label>
      <label
        ><span>网格间距</span
        ><input
          type="number"
          min="5"
          max="100"
          aria-label="网格间距"
          :value="value.gridSize"
          :disabled="busy || !value.grid"
          @change="emit('change', { gridSize: Number(($event.target as HTMLInputElement).value) })"
      /></label>
      <label
        ><span>透明背景</span
        ><input
          type="checkbox"
          aria-label="透明背景"
          :checked="value.background === null"
          :disabled="busy"
          @change="
            emit('change', {
              background: ($event.target as HTMLInputElement).checked ? null : '#ffffff',
            })
          "
      /></label>
      <label
        ><span>背景颜色</span
        ><input
          type="color"
          aria-label="画布背景颜色"
          :value="value.background ?? '#ffffff'"
          :disabled="busy || value.background === null"
          @change="emit('change', { background: ($event.target as HTMLInputElement).value })"
      /></label>
      <p>设置随文档保存，图片导出保留网格和背景。</p>
    </div>
  </details>
</template>
<style scoped>
.canvas-settings {
  position: relative;
  color: #7c8ba1;
  font-size: 10px;
  z-index: 6;
}
.canvas-settings summary {
  display: flex;
  align-items: center;
  gap: 5px;
  list-style: none;
  cursor: pointer;
}
.canvas-settings summary::-webkit-details-marker {
  display: none;
}
.canvas-settings-popover {
  position: absolute;
  right: 0;
  top: 30px;
  width: 225px;
  padding: 14px 16px;
  background: white;
  border: 1px solid #dce4ef;
  border-radius: 7px;
  box-shadow: 0 5px 22px #31456318;
}
.canvas-settings label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 10px 0;
  font-size: 11px;
}
.canvas-settings input {
  accent-color: #657ca8;
}
.canvas-settings input[type='number'] {
  width: 62px;
  padding: 5px;
  border: 1px solid #dce4ef;
  border-radius: 4px;
}
.canvas-settings input[type='color'] {
  width: 28px;
  height: 26px;
  padding: 2px;
  border: 1px solid #dce4ef;
  border-radius: 4px;
  background: white;
}
.canvas-settings p {
  line-height: 1.7;
  color: #9aa8bb;
  font-size: 10px;
  margin: 12px 0 0;
}
</style>
