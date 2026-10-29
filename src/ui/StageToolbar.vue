<script setup lang="ts">
import { computed } from 'vue';
import type { DiagramNode, NodeAppearance } from '../domain/model';

const props = defineProps<{
  stage: DiagramNode;
  busy: boolean;
  position: { left: string; top: string };
}>();
const emit = defineEmits<{ appearance: [patch: Partial<NodeAppearance>] }>();
const inputValue = (event: Event) => (event.target as HTMLInputElement).value;
const direction = computed(
  () =>
    props.stage.appearance.textDirection ??
    (props.stage.type === 'stage-vertical' ? 'vertical' : 'horizontal'),
);
function changeFontSize(event: Event) {
  const size = Number(inputValue(event));
  if (Number.isInteger(size) && size >= 8 && size <= 72) emit('appearance', { fontSize: size });
  else (event.target as HTMLInputElement).value = String(props.stage.appearance.fontSize ?? 12);
}
</script>

<template>
  <div
    class="pool-toolbar stage-toolbar"
    role="toolbar"
    aria-label="阶段工具栏"
    :style="position"
    @pointerdown.stop
    @click.stop
  >
    <span class="pool-toolbar-label">阶段</span>
    <label>
      <input
        type="color"
        aria-label="阶段文字颜色"
        :value="stage.appearance.fontColor ?? '#ffffff'"
        :disabled="busy"
        @change="emit('appearance', { fontColor: inputValue($event) })"
      />
      <span>文字</span>
    </label>
    <label>
      <span>字号</span>
      <input
        class="stage-font-size"
        type="number"
        aria-label="阶段文字大小"
        min="8"
        max="72"
        step="1"
        :value="stage.appearance.fontSize ?? 12"
        :disabled="busy"
        @change="changeFontSize"
      />
    </label>
    <button
      aria-label="阶段文字加粗"
      title="阶段文字加粗"
      :aria-pressed="stage.appearance.fontBold ?? true"
      :class="{ active: stage.appearance.fontBold ?? true }"
      :disabled="busy"
      @click="emit('appearance', { fontBold: !(stage.appearance.fontBold ?? true) })"
    >
      <strong>粗</strong>
    </button>
    <i></i>
    <span>排版方向</span>
    <div class="orientation-switch">
      <button
        aria-label="阶段文字横排"
        :aria-pressed="direction === 'horizontal'"
        :class="{ active: direction === 'horizontal' }"
        :disabled="busy"
        @click="emit('appearance', { textDirection: 'horizontal' })"
      >
        横排
      </button>
      <button
        aria-label="阶段文字竖排"
        :aria-pressed="direction === 'vertical'"
        :class="{ active: direction === 'vertical' }"
        :disabled="busy"
        @click="emit('appearance', { textDirection: 'vertical' })"
      >
        竖排
      </button>
    </div>
  </div>
</template>
