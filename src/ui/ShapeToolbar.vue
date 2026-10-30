<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Component } from 'vue';
import { Activity, ChevronUp, LayoutGrid, PanelLeft, PanelTop, Square } from '@lucide/vue';
import type { PaletteShape } from './palette';

const props = defineProps<{
  shapes: PaletteShape[];
  icons: Record<string, Component>;
  busy: boolean;
  allowSidebar?: boolean;
}>();
const emit = defineEmits<{
  add: [shape: PaletteShape];
  drag: [event: DragEvent, shape: PaletteShape];
  sidebar: [];
}>();
const categories = [
  { id: '容器', label: '泳池', icon: PanelTop },
  { id: '基础图形', label: '基础图形', icon: Square },
  { id: '业务图形', label: '业务图形', icon: Activity },
];
const root = ref<HTMLElement>(),
  menu = ref<HTMLElement>(),
  trigger = ref<HTMLElement>();
const compact = ref(false),
  category = ref<string>();
const sections = computed(() =>
  categories.filter((item) => category.value === 'all' || item.id === category.value),
);
let observer: ResizeObserver | undefined;
async function open(event: Event, id: string, focus = false) {
  trigger.value = event.currentTarget as HTMLElement;
  category.value = category.value === id && !focus ? undefined : id;
  if (focus) {
    await nextTick();
    menu.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }
}
function close(restoreFocus = false) {
  category.value = undefined;
  if (restoreFocus) trigger.value?.focus();
}
function choose(shape: PaletteShape) {
  close(true);
  emit('add', shape);
}
function keyboard(event: KeyboardEvent) {
  const items = [
    ...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
  ];
  const current = items.indexOf(document.activeElement as HTMLElement);
  let index: number;
  if (event.key === 'ArrowDown') index = (current + 1) % items.length;
  else if (event.key === 'ArrowUp') index = (current - 1 + items.length) % items.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = items.length - 1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  items[index]?.focus();
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close();
}
onMounted(() => {
  const parent = root.value?.parentElement;
  observer = new ResizeObserver(([entry]) => {
    const next = entry.contentRect.width < 720;
    if (next !== compact.value) close();
    compact.value = next;
  });
  if (parent) observer.observe(parent);
  document.addEventListener('pointerdown', outside);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('pointerdown', outside);
});
</script>
<template>
  <div
    ref="root"
    class="shape-toolbar"
    role="toolbar"
    aria-label="图形库工具栏"
    @pointerdown.stop
    @wheel.stop
    @keydown.esc.prevent.stop="close(true)"
  >
    <button
      v-if="compact"
      class="category-trigger"
      aria-label="打开全部图形"
      :aria-expanded="category === 'all'"
      aria-haspopup="menu"
      @click="open($event, 'all')"
      @keydown.down.prevent="open($event, 'all', true)"
    >
      <LayoutGrid :size="17" /><span>图形库</span><ChevronUp :size="12" />
    </button>
    <template v-else>
      <button
        v-for="item in categories"
        :key="item.id"
        class="category-trigger"
        :aria-label="`打开${item.label}`"
        :aria-expanded="category === item.id"
        aria-haspopup="menu"
        @click="open($event, item.id)"
        @keydown.down.prevent="open($event, item.id, true)"
      >
        <component :is="item.icon" :size="17" /><span>{{ item.label }}</span
        ><ChevronUp :size="12" />
      </button>
    </template>
    <i v-if="allowSidebar !== false"></i>
    <button
      v-if="allowSidebar !== false"
      class="sidebar-mode"
      aria-label="切换到图形库侧栏模式"
      title="侧栏模式"
      @click="emit('sidebar')"
    >
      <PanelLeft :size="17" />
    </button>
    <div
      v-if="category"
      ref="menu"
      class="shape-toolbar-menu"
      role="menu"
      aria-label="选择图形"
      @keydown="keyboard"
      @dragend="close()"
    >
      <section v-for="section in sections" :key="section.id">
        <h3>{{ section.label }}</h3>
        <div class="shape-menu-grid">
          <button
            v-for="shape in props.shapes.filter((item) => item.category === section.id)"
            :key="shape.id"
            role="menuitem"
            :aria-label="shape.label"
            :disabled="busy"
            draggable="true"
            :title="`点击或拖入：${shape.label}`"
            @click="choose(shape)"
            @dragstart="emit('drag', $event, shape)"
          >
            <component :is="icons[shape.icon]" :size="18" /><span>{{ shape.label }}</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
<style scoped>
.shape-toolbar {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 3px;
  max-width: calc(100% - 32px);
  padding: 6px;
  background: white;
  border: 1px solid #e3e7ed;
  border-radius: 11px;
  box-shadow: 0 6px 24px #30456812;
  color: #7c8ba1;
}
.shape-toolbar > button {
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 6px;
  padding: 0 10px;
  flex-shrink: 0;
  font-size: 11px;
  white-space: nowrap;
}
.shape-toolbar > button:hover,
.shape-toolbar > button[aria-expanded='true'] {
  background: #edf1f8;
  color: #496089;
}
.shape-toolbar > i {
  width: 1px;
  height: 20px;
  margin: 0 5px;
  background: #e6ebf2;
}
.shape-toolbar > .sidebar-mode {
  width: 34px;
  padding: 0;
}
.shape-toolbar-menu {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  width: 320px;
  max-width: calc(100vw - 64px);
  max-height: min(540px, calc(100vh - 210px));
  overflow: auto;
  padding: 8px 12px 12px;
  border: 1px solid #e3e7ed;
  border-radius: 12px;
  box-shadow: 0 8px 32px #30456820;
  background: white;
}
.shape-toolbar-menu h3 {
  font-size: 10px;
  font-weight: 500;
  color: #9aa7ba;
  margin: 12px 4px 8px;
}
.shape-menu-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.shape-menu-grid button {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 40px;
  padding: 9px;
  border: 1px solid transparent;
  border-radius: 6px;
  text-align: left;
  font-size: 11px;
  color: #72829b;
}
.shape-menu-grid button:hover:not(:disabled),
.shape-menu-grid button:focus-visible {
  border-color: #dce5f3;
  background: #f4f7fc;
  color: #496089;
}
</style>
