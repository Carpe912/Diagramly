<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  Copy,
  FolderOpen,
  GitBranch,
  Hand,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from '@lucide/vue';
import CanvasSettingsPanel from './CanvasSettings.vue';
import type { CanvasSettings } from '../domain/model';

defineProps<{
  tool: 'select' | 'hand' | 'connect';
  nodeCount: number;
  edgeCount: number;
  busy: boolean;
  remote: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selected: boolean;
  settings: CanvasSettings;
}>();
const emit = defineEmits<{
  tool: [tool: 'select' | 'hand' | 'connect'];
  history: [action: 'undo' | 'redo'];
  duplicate: [];
  remove: [];
  reset: [kind: 'empty' | 'sample'];
  settings: [patch: Partial<CanvasSettings>];
}>();
const root = ref<HTMLElement>(),
  compact = ref(false),
  menuOpen = ref(false);
let observer: ResizeObserver | undefined;
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) menuOpen.value = false;
}
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    compact.value = entry.contentRect.width < 760;
    if (!compact.value) menuOpen.value = false;
  });
  if (root.value) observer.observe(root.value);
  document.addEventListener('pointerdown', outside);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('pointerdown', outside);
});
</script>
<template>
  <div ref="root" class="canvas-topbar" :class="{ compact }" @keydown.esc="menuOpen = false">
    <div class="topbar-start">
      <div class="topbar-tools" role="toolbar" aria-label="画布工具">
        <button
          aria-label="选择工具"
          title="选择 (V)"
          :aria-pressed="tool === 'select'"
          :class="{ active: tool === 'select' }"
          @click="emit('tool', 'select')"
        >
          <MousePointer2 :size="16" />
        </button>
        <button
          aria-label="平移工具"
          title="平移 (H)"
          :aria-pressed="tool === 'hand'"
          :class="{ active: tool === 'hand' }"
          @click="emit('tool', 'hand')"
        >
          <Hand :size="16" />
        </button>
        <button
          aria-label="连接工具"
          title="连接 (C)"
          :aria-pressed="tool === 'connect'"
          :class="{ active: tool === 'connect' }"
          @click="emit('tool', 'connect')"
        >
          <GitBranch :size="16" />
        </button>
        <i></i>
        <button
          aria-label="撤销"
          title="撤销 (⌘Z)"
          :disabled="busy || !canUndo"
          @click="emit('history', 'undo')"
        >
          <Undo2 :size="16" />
        </button>
        <button
          aria-label="重做"
          title="重做 (⇧⌘Z)"
          :disabled="busy || !canRedo"
          @click="emit('history', 'redo')"
        >
          <Redo2 :size="16" />
        </button>
        <template v-if="selected">
          <i></i>
          <button
            aria-label="复制所选"
            title="复制 (⌘D)"
            :disabled="busy"
            @click="emit('duplicate')"
          >
            <Copy :size="15" />
          </button>
          <button
            aria-label="删除所选"
            title="删除 (Delete)"
            :disabled="busy"
            @click="emit('remove')"
          >
            <Trash2 :size="15" />
          </button>
        </template>
      </div>
      <span v-if="!compact" class="subtle"
        >{{ nodeCount }} 个节点 <span class="middot">·</span> {{ edgeCount }} 条连线</span
      >
    </div>
    <button
      v-if="compact"
      class="topbar-more"
      aria-label="更多画布操作"
      :aria-expanded="menuOpen"
      @click="menuOpen = !menuOpen"
    >
      <MoreHorizontal :size="18" />
    </button>
    <div v-show="!compact || menuOpen" class="canvas-file-actions" :class="{ popover: compact }">
      <CanvasSettingsPanel :value="settings" :busy="busy" @change="emit('settings', $event)" />
      <button
        class="quiet-button"
        :disabled="busy"
        @click="
          emit('reset', 'empty');
          menuOpen = false;
        "
      >
        <Plus :size="14" />新建文档
      </button>
      <button
        class="quiet-button"
        :disabled="remote || busy"
        @click="
          emit('reset', 'sample');
          menuOpen = false;
        "
      >
        <FolderOpen :size="14" />打开示例
      </button>
    </div>
  </div>
</template>
<style scoped>
.canvas-topbar {
  gap: 12px;
  padding: 0 14px;
}
.canvas-topbar .topbar-start {
  gap: 14px;
  min-width: 0;
}
.topbar-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.topbar-tools button,
.topbar-more {
  display: grid;
  place-items: center;
  width: 28px;
  height: 29px;
  border-radius: 5px;
  color: #8a96a7;
}
.topbar-tools button:hover:not(:disabled),
.topbar-more:hover {
  background: #f0f3f9;
}
.topbar-tools button.active {
  color: #496089;
  background: #edf1f8;
}
.topbar-tools i {
  width: 1px;
  height: 17px;
  background: #e6ebf2;
  margin: 0 5px;
}
.canvas-file-actions {
  flex-shrink: 0;
}
.canvas-file-actions.popover {
  position: absolute;
  right: 12px;
  top: 43px;
  width: 180px;
  padding: 12px;
  flex-direction: column;
  align-items: stretch;
  gap: 18px;
  background: white;
  border: 1px solid #e3e7ed;
  border-radius: 9px;
  box-shadow: 0 8px 28px #30456818;
}
</style>
