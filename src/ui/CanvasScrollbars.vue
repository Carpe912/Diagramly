<script setup lang="ts">
import { computed, ref } from 'vue';
const props = defineProps<{ container: HTMLElement; tick: number }>();
type Axis = 'horizontal' | 'vertical';
const dragging = ref<Axis>();
let dragStart: { pointer: number; scroll: number; ratio: number; axis: Axis } | undefined;
const bars = computed(() => {
  void props.tick;
  const el = props.container,
    width = el.clientWidth,
    height = el.clientHeight;
  if (!width || !height) return [];
  const horizontal = el.scrollWidth > width + 1,
    vertical = el.scrollHeight > height + 1;
  return (['horizontal', 'vertical'] as const).flatMap((axis) => {
    const isHorizontal = axis === 'horizontal';
    if (!(isHorizontal ? horizontal : vertical)) return [];
    const visible = isHorizontal ? width : height,
      total = isHorizontal ? el.scrollWidth : el.scrollHeight;
    const track = Math.max(0, visible - ((isHorizontal ? vertical : horizontal) ? 12 : 0));
    const thumb = Math.min(track, Math.max(24, (track * visible) / total)),
      maximum = total - visible,
      scroll = isHorizontal ? el.scrollLeft : el.scrollTop;
    return [
      {
        axis,
        maximum,
        scroll,
        track,
        thumb,
        offset: maximum ? (scroll / maximum) * (track - thumb) : 0,
        style: isHorizontal
          ? {
              left: `${el.offsetLeft}px`,
              top: `${el.offsetTop + height - 12}px`,
              width: `${track}px`,
              height: '12px',
            }
          : {
              left: `${el.offsetLeft + width - 12}px`,
              top: `${el.offsetTop}px`,
              width: '12px',
              height: `${track}px`,
            },
      },
    ];
  });
});
function position(axis: Axis, value: number) {
  if (axis === 'horizontal') props.container.scrollLeft = value;
  else props.container.scrollTop = value;
}
function start(event: PointerEvent, axis: Axis) {
  if (event.button !== 0) return;
  event.preventDefault();
  const track = event.currentTarget as HTMLElement,
    bar = bars.value.find((b) => b.axis === axis)!;
  track.focus({ preventScroll: true });
  track.setPointerCapture(event.pointerId);
  const pointer = axis === 'horizontal' ? event.clientX : event.clientY;
  if (!(event.target as HTMLElement).classList.contains('scrollbar-thumb')) {
    const rect = track.getBoundingClientRect(),
      local = pointer - (axis === 'horizontal' ? rect.left : rect.top);
    position(axis, ((local - bar.thumb / 2) / Math.max(1, bar.track - bar.thumb)) * bar.maximum);
  }
  dragStart = {
    pointer,
    scroll: axis === 'horizontal' ? props.container.scrollLeft : props.container.scrollTop,
    ratio: bar.maximum / Math.max(1, bar.track - bar.thumb),
    axis,
  };
  dragging.value = axis;
}
function move(event: PointerEvent) {
  if (!dragStart) return;
  const pointer = dragStart.axis === 'horizontal' ? event.clientX : event.clientY;
  position(dragStart.axis, dragStart.scroll + (pointer - dragStart.pointer) * dragStart.ratio);
}
function finish() {
  dragStart = undefined;
  dragging.value = undefined;
}
function keyboard(event: KeyboardEvent, axis: Axis) {
  const bar = bars.value.find((b) => b.axis === axis)!;
  const back = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp',
    forward = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const value =
    event.key === back
      ? bar.scroll - 40
      : event.key === forward
        ? bar.scroll + 40
        : event.key === 'PageUp'
          ? bar.scroll - bar.track * 0.9
          : event.key === 'PageDown'
            ? bar.scroll + bar.track * 0.9
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? bar.maximum
                : undefined;
  if (value === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  position(axis, value);
}
function wheel(event: WheelEvent, axis: Axis) {
  const bar = bars.value.find((b) => b.axis === axis)!;
  const delta =
    (axis === 'horizontal' ? event.deltaX || event.deltaY : event.deltaY) *
    (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bar.track : 1);
  position(axis, bar.scroll + delta);
}
</script>
<template>
  <div
    v-for="bar in bars"
    :key="bar.axis"
    :class="['canvas-scrollbar', bar.axis, { dragging: dragging === bar.axis }]"
    :style="bar.style"
    role="scrollbar"
    tabindex="0"
    :aria-label="bar.axis === 'horizontal' ? '水平滚动条' : '垂直滚动条'"
    :aria-orientation="bar.axis"
    aria-controls="diagram-canvas"
    :aria-valuemin="0"
    :aria-valuemax="Math.round(bar.maximum)"
    :aria-valuenow="Math.round(bar.scroll)"
    @pointerdown.stop="start($event, bar.axis)"
    @pointermove.stop="move"
    @pointerup.stop="finish"
    @pointercancel="finish"
    @lostpointercapture="finish"
    @keydown="keyboard($event, bar.axis)"
    @wheel.prevent.stop="wheel($event, bar.axis)"
  >
    <div
      class="scrollbar-thumb"
      :style="
        bar.axis === 'horizontal'
          ? { width: `${bar.thumb}px`, transform: `translateX(${bar.offset}px)` }
          : { height: `${bar.thumb}px`, transform: `translateY(${bar.offset}px)` }
      "
    ></div>
  </div>
</template>
<style scoped>
.canvas-scrollbar {
  position: absolute;
  z-index: 3;
  background: #f1f4f9;
  touch-action: none;
  user-select: none;
  border-radius: 6px;
}
.scrollbar-thumb {
  position: absolute;
  background: #b9c6d9;
  border: 2px solid #f1f4f9;
  border-radius: 6px;
  box-sizing: border-box;
}
.horizontal .scrollbar-thumb {
  height: 12px;
  top: 0;
  left: 0;
}
.vertical .scrollbar-thumb {
  width: 12px;
  top: 0;
  left: 0;
}
.canvas-scrollbar:hover .scrollbar-thumb,
.canvas-scrollbar.dragging .scrollbar-thumb {
  background: #8fa5c3;
}
.canvas-scrollbar:focus-visible {
  outline: 2px solid #829bc1;
  outline-offset: 1px;
}
</style>
