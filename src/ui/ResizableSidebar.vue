<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
const props = defineProps<{
  side: 'left' | 'right';
  label: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}>();
const emit = defineEmits<{ resized: [] }>();
const element = ref<HTMLElement>(),
  parentWidth = ref(window.innerWidth),
  parentHeight = ref(Math.max(280, window.innerHeight - 104));
const preferred = reactive<{ width: number | null; height: number | null }>({
  width: null,
  height: null,
});
const collapsed = ref(false);
const storageKey = `diagramly.sidebar.${props.side}.v1`;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
  collapsed.value = saved?.collapsed === true;
  if (saved && typeof saved.width === 'number' && Number.isFinite(saved.width))
    preferred.width = saved.width;
  if (saved && typeof saved.height === 'number' && Number.isFinite(saved.height))
    preferred.height = saved.height;
} catch {
  /* 本机布局偏好损坏时恢复默认尺寸。 */
}
// 窄窗口会收紧宽度上限，确保两个侧栏展开后画布仍有操作空间。
const maxWidth = computed(() =>
  Math.max(
    props.minWidth,
    Math.min(props.maxWidth, Math.floor(parentWidth.value * (props.side === 'left' ? 0.28 : 0.4))),
  ),
);
const minHeight = computed(() => Math.min(280, parentHeight.value));
const width = computed(() =>
  Math.max(props.minWidth, Math.min(maxWidth.value, preferred.width ?? props.defaultWidth)),
);
const height = computed(() =>
  Math.max(minHeight.value, Math.min(parentHeight.value, preferred.height ?? parentHeight.value)),
);
const style = computed(() => ({
  width: `${collapsed.value ? 36 : width.value}px`,
  height: `${collapsed.value ? parentHeight.value : height.value}px`,
}));
type Axis = 'width' | 'height' | 'both';
let drag:
  | {
      id: number;
      axis: Axis;
      x: number;
      y: number;
      width: number;
      height: number;
      previous: { width: number | null; height: number | null };
    }
  | undefined;
const resizing = ref(false);
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...preferred, collapsed: collapsed.value }));
  } catch {
    /* 布局偏好保存失败不影响业务文档。 */
  }
}
async function resized() {
  await nextTick();
  emit('resized');
}
function toggle() {
  collapsed.value = !collapsed.value;
  persist();
  void resized();
}
function setSize(axis: Axis, nextWidth: number, nextHeight: number) {
  if (axis !== 'height')
    preferred.width = Math.max(props.minWidth, Math.min(maxWidth.value, Math.round(nextWidth)));
  if (axis !== 'width')
    preferred.height = Math.max(
      minHeight.value,
      Math.min(parentHeight.value, Math.round(nextHeight)),
    );
}
function start(event: PointerEvent, axis: Axis) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  drag = {
    id: event.pointerId,
    axis,
    x: event.clientX,
    y: event.clientY,
    width: width.value,
    height: height.value,
    previous: { ...preferred },
  };
  resizing.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = (event.clientX - drag.x) * (props.side === 'left' ? 1 : -1);
  setSize(drag.axis, drag.width + dx, drag.height + event.clientY - drag.y);
}
function finish(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return;
  if (event.type === 'pointercancel') Object.assign(preferred, drag.previous);
  else {
    if (preferred.height === parentHeight.value) preferred.height = null;
    persist();
  }
  drag = undefined;
  resizing.value = false;
  void resized();
}
function keyboard(event: KeyboardEvent, axis: Axis) {
  const step = event.shiftKey ? 30 : 10;
  let w = width.value,
    h = height.value;
  if (axis !== 'height' && ['ArrowLeft', 'ArrowRight'].includes(event.key))
    w += (event.key === 'ArrowRight' ? 1 : -1) * (props.side === 'left' ? 1 : -1) * step;
  else if (axis !== 'width' && ['ArrowUp', 'ArrowDown'].includes(event.key))
    h += (event.key === 'ArrowDown' ? 1 : -1) * step;
  else if (event.key === 'Home') {
    if (axis !== 'height') w = props.minWidth;
    if (axis !== 'width') h = minHeight.value;
  } else if (event.key === 'End') {
    if (axis !== 'height') w = maxWidth.value;
    if (axis !== 'width') h = parentHeight.value;
  } else return;
  event.preventDefault();
  event.stopPropagation();
  setSize(axis, w, h);
  persist();
  void resized();
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  const parent = element.value?.parentElement;
  if (!parent) return;
  observer = new ResizeObserver(() => {
    parentWidth.value = parent.clientWidth;
    parentHeight.value = parent.clientHeight;
  });
  observer.observe(parent);
});
watch(
  () => [maxWidth.value, parentHeight.value],
  () => {
    void resized();
  },
);
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <aside
    ref="element"
    :style="style"
    :class="['resizable-sidebar', `sidebar-${side}`, { resizing, collapsed }]"
    :data-resizable-sidebar="side"
    :aria-label="label"
  >
    <button
      class="sidebar-collapse"
      :aria-label="`${collapsed ? '展开' : '折叠'}${label}`"
      :title="`${collapsed ? '展开' : '折叠'}${label}`"
      :aria-expanded="!collapsed"
      @click="toggle"
    >
      <component :is="(side === 'left') !== collapsed ? ChevronLeft : ChevronRight" :size="14" />
    </button>
    <span v-if="collapsed" class="collapsed-label">{{
      label === '图形库侧栏' ? '图形库' : '属性面板'
    }}</span>
    <div v-show="!collapsed" class="sidebar-content"><slot /></div>
    <div
      v-if="!collapsed"
      class="sidebar-resize-width"
      role="separator"
      tabindex="0"
      :aria-label="`${label}宽度`"
      aria-orientation="vertical"
      :aria-valuemin="minWidth"
      :aria-valuemax="maxWidth"
      :aria-valuenow="width"
      @pointerdown="start($event, 'width')"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="finish"
      @keydown="keyboard($event, 'width')"
    ></div>
    <div
      v-if="!collapsed"
      class="sidebar-resize-height"
      role="separator"
      tabindex="0"
      :aria-label="`${label}高度`"
      aria-orientation="horizontal"
      :aria-valuemin="minHeight"
      :aria-valuemax="parentHeight"
      :aria-valuenow="height"
      @pointerdown="start($event, 'height')"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="finish"
      @keydown="keyboard($event, 'height')"
    ></div>
    <div
      v-if="!collapsed"
      class="sidebar-resize-corner"
      role="button"
      tabindex="0"
      :aria-label="`${label}宽高`"
      title="拖拽调整宽高"
      @pointerdown="start($event, 'both')"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="finish"
      @keydown="keyboard($event, 'both')"
    ></div>
  </aside>
</template>
<style scoped>
.resizable-sidebar {
  position: relative;
  align-self: flex-start;
  min-height: 0;
  max-height: 100%;
  flex-shrink: 0;
}
.resizable-sidebar.resizing {
  user-select: none;
  z-index: 7;
}
.sidebar-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.sidebar-collapse {
  position: absolute;
  right: 7px;
  top: 13px;
  width: 22px;
  height: 23px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  color: #8a99af;
  z-index: 10;
  background: white;
}
.sidebar-collapse:hover {
  background: #edf1f8;
}
.collapsed .sidebar-collapse {
  right: 6px;
}
.collapsed-label {
  writing-mode: vertical-rl;
  align-self: center;
  margin-top: 58px;
  color: #98a4b6;
  font-size: 10px;
  letter-spacing: 3px;
}
.sidebar-content :deep(.panel-tabs) {
  padding-right: 36px;
  gap: 18px;
}
.sidebar-resize-width {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 7px;
  z-index: 8;
  cursor: ew-resize;
  touch-action: none;
}
.sidebar-left .sidebar-resize-width {
  right: -3px;
}
.sidebar-right .sidebar-resize-width {
  left: -3px;
}
.sidebar-resize-height {
  position: absolute;
  bottom: -3px;
  height: 7px;
  left: 0;
  right: 0;
  z-index: 8;
  cursor: ns-resize;
  touch-action: none;
}
.sidebar-resize-corner {
  position: absolute;
  bottom: -2px;
  width: 13px;
  height: 13px;
  z-index: 9;
  touch-action: none;
  border-bottom: 2px solid #b4c1d5;
  opacity: 0.6;
}
.sidebar-left .sidebar-resize-corner {
  right: -2px;
  cursor: nwse-resize;
  border-right: 2px solid #b4c1d5;
}
.sidebar-right .sidebar-resize-corner {
  left: -2px;
  cursor: nesw-resize;
  border-left: 2px solid #b4c1d5;
}
.sidebar-resize-width:hover,
.sidebar-resize-height:hover,
.sidebar-resize-width:focus-visible,
.sidebar-resize-height:focus-visible {
  background: #8298c033;
}
.sidebar-resize-corner:hover {
  opacity: 1;
}
</style>
