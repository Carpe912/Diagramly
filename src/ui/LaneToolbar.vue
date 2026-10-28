<script setup lang="ts">
import { computed } from 'vue';
import { UsersRound } from '@lucide/vue';
import type { BusinessEntity, DiagramDocument, DiagramNode } from '../domain/model';
import type { Organization } from '../adapters/coopwire/api';
import { poolOf } from '../domain/pools';
const props = defineProps<{
  document: DiagramDocument;
  lane: DiagramNode;
  organizations: Organization[];
  busy: boolean;
  position: { left: string; top: string };
}>();
const emit = defineEmits<{
  appearance: [patch: { fill?: string; headerFill?: string; fontColor?: string }];
  roles: [patch: Partial<BusinessEntity>];
}>();
const entity = computed(() => props.document.entities[props.lane.entityId]);
const pool = computed(() => poolOf(props.document, props.lane));
const color = (key: 'fill' | 'headerFill' | 'fontColor', fallback: string) =>
  props.lane.appearance[key] ?? pool.value?.appearance[key] ?? fallback;
function selectRoles(event: Event) {
  emit('roles', {
    roleIds: Array.from(
      (event.target as HTMLSelectElement).selectedOptions,
      (option) => option.value,
    ),
  });
}
</script>
<template>
  <div
    class="pool-toolbar lane-toolbar"
    role="toolbar"
    aria-label="泳道工具栏"
    :style="position"
    @pointerdown.stop
    @click.stop
  >
    <span class="pool-toolbar-label">泳道</span>
    <label
      ><input
        type="color"
        aria-label="泳道背景色"
        :value="color('fill', '#ffffff')"
        :disabled="busy"
        @change="emit('appearance', { fill: ($event.target as HTMLInputElement).value })"
      /><span>背景</span></label
    >
    <label
      ><input
        type="color"
        aria-label="泳道标题背景色"
        :value="color('headerFill', '#f6f8fb')"
        :disabled="busy"
        @change="emit('appearance', { headerFill: ($event.target as HTMLInputElement).value })"
      /><span>标题</span></label
    >
    <label
      ><input
        type="color"
        aria-label="泳道文字颜色"
        :value="color('fontColor', '#52637d')"
        :disabled="busy"
        @change="emit('appearance', { fontColor: ($event.target as HTMLInputElement).value })"
      /><span>文字</span></label
    >
    <i></i>
    <details class="lane-role-picker" :key="lane.id">
      <summary>
        <UsersRound :size="14" />角色泳道<span v-if="entity.roleIds.length">{{
          entity.roleIds.length
        }}</span>
      </summary>
      <div class="lane-role-popover">
        <label
          >角色说明<input
            :value="entity.role"
            aria-label="泳道工具栏角色说明"
            :disabled="busy"
            placeholder="例如：销售负责人"
            @change="emit('roles', { role: ($event.target as HTMLInputElement).value })"
        /></label>
        <label v-if="organizations.length"
          >组织角色<select
            multiple
            aria-label="泳道工具栏组织角色"
            :value="entity.roleIds"
            :disabled="busy"
            @change="selectRoles"
          >
            <option v-for="org in organizations" :key="org.orgId" :value="org.orgId">
              {{ org.orgName }}
            </option>
          </select></label
        >
        <p v-else>连接 Coopwire 后可选择项目组织角色。</p>
      </div>
    </details>
  </div>
</template>
