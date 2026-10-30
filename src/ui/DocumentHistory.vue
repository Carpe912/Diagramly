<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { z } from 'zod';
import BusinessDialog from './BusinessDialog.vue';
import { request, getDocument } from '../adapters/server/client';
import { documentSchema, type DiagramDocument } from '../domain/model';
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: []; open: [document: DiagramDocument, revision: number] }>();
const versions = ref<{ revision: number; title: string; label?: string; created_at: string }[]>([]);
const versionName = ref('');
const details = ref<string[]>([]);
async function nameVersion() {
  if (!selected.value) return;
  await perform(async () => {
    await request(`/documents/${props.id}/versions/${selected.value}/name`, {
      method: 'POST',
      body: JSON.stringify({ label: versionName.value }),
    });
    versions.value = await request(`/documents/${props.id}/versions`);
  });
}
const selected = ref<number>(),
  summary = ref(''),
  confirmed = ref(false),
  busy = ref(false),
  error = ref('');
let currentRevision = 0;
async function perform(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    busy.value = false;
  }
}
onMounted(
  () =>
    void perform(async () => {
      versions.value = z
        .array(
          z.object({
            revision: z.number(),
            title: z.string(),
            label: z.string().optional(),
            created_at: z.string(),
          }),
        )
        .parse(await request(`/documents/${props.id}/versions`));
    }),
);
async function compare(revision: number) {
  await perform(async () => {
    const [current, previous] = await Promise.all([
      getDocument(props.id),
      request(`/documents/${props.id}/versions/${revision}`),
    ]);
    const older = documentSchema.parse(previous.document),
      newer = current.document;
    const changes = (a: Record<string, unknown>, b: Record<string, unknown>) => ({
      added: Object.keys(b).filter((id) => !a[id]).length,
      removed: Object.keys(a).filter((id) => !b[id]).length,
      modified: Object.keys(a).filter(
        (id) => b[id] && JSON.stringify(a[id]) !== JSON.stringify(b[id]),
      ).length,
    });
    const nodes = changes(older.nodes, newer.nodes),
      entities = changes(older.entities, newer.entities),
      edges = changes(older.edges, newer.edges);
    details.value = [];
    const describe = (value: unknown) => JSON.stringify(value)?.slice(0, 160) ?? '未设置';
    for (const id of new Set([...Object.keys(older.entities), ...Object.keys(newer.entities)])) {
      const before = older.entities[id],
        after = newer.entities[id];
      if (!before) {
        details.value.push(`新增：${after.name}`);
        continue;
      }
      if (!after) {
        details.value.push(`删除：${before.name}`);
        continue;
      }
      for (const field of [
        'name',
        'description',
        'activityType',
        'roleIds',
        'inputs',
        'outputs',
        'details',
        'resources',
      ] as const)
        if (JSON.stringify(before[field]) !== JSON.stringify(after[field]))
          details.value.push(
            `${after.name} · ${field}：${describe(before[field])} → ${describe(after[field])}`,
          );
    }
    for (const [id, node] of Object.entries(newer.nodes))
      if (older.nodes[id] && JSON.stringify(older.nodes[id].bounds) !== JSON.stringify(node.bounds))
        details.value.push(
          `${newer.entities[node.entityId].name} · 布局：${describe(older.nodes[id].bounds)} → ${describe(node.bounds)}`,
        );
    summary.value = `相对 v${revision}，当前 v${current.revision}：图形新增 ${nodes.added}、删除 ${nodes.removed}、修改 ${nodes.modified}；业务实体修改 ${entities.modified}；连线新增 ${edges.added}、删除 ${edges.removed}、修改 ${edges.modified}。`;
    selected.value = revision;
    currentRevision = current.revision;
    confirmed.value = false;
  });
}
async function restore() {
  if (!selected.value || !confirmed.value) return;
  await perform(async () => {
    const result = z.object({ document: documentSchema, revision: z.number() }).parse(
      await request(`/documents/${props.id}/restore`, {
        method: 'POST',
        body: JSON.stringify({ revision: selected.value, expectedRevision: currentRevision }),
      }),
    );
    emit('open', result.document, result.revision);
  });
}
</script>
<template>
  <BusinessDialog title="版本历史" :busy="busy" @close="emit('close')"
    ><form @submit.prevent="restore">
      <p class="field-help">恢复会生成新版本，保留现有历史；先将未同步的本机草稿另存为副本。</p>
      <button
        v-for="row in versions"
        :key="row.revision"
        type="button"
        class="button secondary"
        :disabled="busy"
        @click="compare(row.revision)"
      >
        v{{ row.revision }} · {{ row.label || row.title }} ·
        {{ new Date(row.created_at).toLocaleString() }}
      </button>
      <p v-if="!versions.length" class="field-help">暂无历史版本</p>
      <template v-if="selected"
        ><label>版本名称<input v-model="versionName" maxlength="160" /></label
        ><button
          type="button"
          class="button secondary"
          :disabled="busy || !versionName.trim()"
          @click="nameVersion"
        >
          保存版本名称
        </button>
        <p class="field-help">{{ summary }}</p>
        <ul class="version-diff">
          <li v-for="(change, index) in details.slice(0, 100)" :key="index">{{ change }}</li>
        </ul>
        <p v-if="details.length > 100" class="field-help">
          仅展示前100条差异，请结合完整文档核对。
        </p>
        <label class="toggle-label"
          >确认将历史内容恢复为新版本<input v-model="confirmed" type="checkbox" /></label
      ></template>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <footer>
        <button type="button" class="button secondary" :disabled="busy" @click="emit('close')">
          关闭</button
        ><button v-if="selected" class="button primary" :disabled="busy || !confirmed">
          恢复为新版本
        </button>
      </footer>
    </form></BusinessDialog
  >
</template>

<style scoped>
.version-diff {
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
  padding-left: 18px;
  color: #657b96;
}
</style>
