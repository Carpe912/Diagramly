<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Plus, Trash2, PanelTop, PanelLeft } from '@lucide/vue';
import type { DiagramDocument, DiagramNode } from '../domain/model';
import { poolLanes } from '../domain/pools';
const props = defineProps<{ document: DiagramDocument; pool: DiagramNode; selectedLaneId?: string; busy: boolean; position: { left: string; top: string } }>();
const emit = defineEmits<{
  add: []; remove: [laneId: string]; orientation: [orientation: 'horizontal' | 'vertical'];
  appearance: [patch: { fill?: string; headerFill?: string; fontColor?: string }];
}>();
const lanes = computed(() => poolLanes(props.document, props.pool.id)), target = ref('');
watch(() => [props.pool.id, props.selectedLaneId, lanes.value.map((n) => n.id).join(',')], () => {
  if (props.selectedLaneId && lanes.value.some((n) => n.id === props.selectedLaneId)) target.value = props.selectedLaneId;
  else if (!lanes.value.some((n) => n.id === target.value)) target.value = lanes.value.at(-1)?.id ?? '';
}, { immediate: true });
const color = (event: Event) => (event.target as HTMLInputElement).value;
</script>
<template>
  <div class="pool-toolbar" role="toolbar" aria-label="泳池工具栏" :style="position" @pointerdown.stop @click.stop>
    <span class="pool-toolbar-label">泳池</span>
    <div class="orientation-switch">
      <button aria-label="水平布局" title="水平泳池：泳道按行排列" :aria-pressed="pool.type === 'pool-horizontal'" :class="{ active: pool.type === 'pool-horizontal' }" :disabled="busy" @click="emit('orientation', 'horizontal')"><PanelLeft :size="14" />水平</button>
      <button aria-label="垂直布局" title="垂直泳池：泳道按列排列" :aria-pressed="pool.type === 'pool-vertical'" :class="{ active: pool.type === 'pool-vertical' }" :disabled="busy" @click="emit('orientation', 'vertical')"><PanelTop :size="14" />垂直</button>
    </div>
    <i></i>
    <button class="pool-add-lane" aria-label="添加泳道" :disabled="busy" @click="emit('add')"><Plus :size="15" /><span>添加泳道</span></button>
    <select v-model="target" aria-label="操作泳道" :disabled="busy"><option v-for="lane in lanes" :key="lane.id" :value="lane.id">{{ document.entities[lane.entityId].name }}</option></select>
    <button class="pool-remove-lane" aria-label="删除泳道" :disabled="busy || lanes.length <= 1 || !target" :title="lanes.length <= 1 ? '泳池至少保留一条泳道' : '删除选定泳道'" @click="emit('remove', target)"><Trash2 :size="14" /></button>
    <i></i>
    <label title="统一修改泳池及泳道的背景色"><input type="color" aria-label="泳池背景色" :value="pool.appearance.fill ?? '#ffffff'" :disabled="busy" @change="emit('appearance', { fill: color($event) })" /><span>背景</span></label>
    <label title="统一修改泳池及泳道的标题背景"><input type="color" aria-label="泳池标题背景色" :value="pool.appearance.headerFill ?? '#edf1f8'" :disabled="busy" @change="emit('appearance', { headerFill: color($event) })" /><span>标题</span></label>
    <label title="统一修改泳池及泳道的文字颜色"><input type="color" aria-label="泳池文字颜色" :value="pool.appearance.fontColor ?? '#52637d'" :disabled="busy" @change="emit('appearance', { fontColor: color($event) })" /><span>文字</span></label>
  </div>
</template>
