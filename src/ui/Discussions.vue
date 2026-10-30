<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { request } from '../adapters/server/client';
import type { DiagramDocument } from '../domain/model';
const props = defineProps<{ document: DiagramDocument; anchor?: string; connected: boolean }>();
const emit = defineEmits<{ select: [id: string] }>();
const rows = ref<Record<string, any>[]>([]),
  text = ref(''),
  reply = ref<Record<string, string>>({}),
  busy = ref(false),
  error = ref('');
async function load() {
  if (props.connected) rows.value = await request(`/documents/${props.document.id}/discussions`);
}
async function action(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() => void action(load));
watch(
  () => props.document.id,
  () => void action(load),
);
async function create() {
  await action(async () => {
    await request(`/documents/${props.document.id}/discussions`, {
      method: 'POST',
      body: JSON.stringify({ anchor: props.anchor ?? null, body: text.value }),
    });
    text.value = '';
    await load();
  });
}
async function update(row: Record<string, any>, status?: string) {
  await action(async () => {
    await request(`/discussions/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedRevision: row.revision,
        ...(status ? { status } : { reply: reply.value[row.id] }),
      }),
    });
    reply.value[row.id] = '';
    await load();
  });
}
function label(anchor: string) {
  const node = props.document.nodes[anchor];
  return node
    ? props.document.entities[node.entityId].name
    : props.document.edges[anchor]
      ? '连线'
      : '锚点已删除';
}
</script>
<template>
  <div class="discussion-panel">
    <p v-if="!connected" class="field-help">请在文档库打开服务端文档后使用讨论。</p>
    <template v-else
      ><form @submit.prevent="create">
        <label
          >{{ anchor ? '对选中图形提问' : '对整张图提问'
          }}<textarea v-model="text" required maxlength="10000" rows="3" /></label
        ><button class="button secondary" :disabled="busy">提交讨论</button>
      </form>
      <p v-if="error" role="alert" class="form-error">{{ error }}</p>
      <article v-for="row in rows" :key="row.id">
        <button v-if="row.anchor" class="quiet-button" @click="emit('select', row.anchor)">
          {{ label(row.anchor) }}</button
        ><span v-else>整张图</span
        ><small>{{ row.status === 'resolved' ? '已解决' : '待处理' }}</small>
        <span class="field-help">{{ row.author }}</span>
        <p>{{ row.body }}</p>
        <blockquote v-for="(item, index) in row.replies" :key="index">
          <span>{{ item.author ?? '用户' }}</span>
          <p>{{ item.body }}</p>
        </blockquote>
        <form @submit.prevent="update(row)">
          <label
            >回复<textarea v-model="reply[row.id]" required maxlength="10000" rows="2" />
          </label>
          <div>
            <button class="quiet-button" :disabled="busy">回复</button
            ><button
              type="button"
              class="quiet-button"
              :disabled="busy"
              @click="update(row, row.status === 'resolved' ? 'open' : 'resolved')"
            >
              {{ row.status === 'resolved' ? '重新打开' : '标记解决' }}
            </button>
          </div>
        </form>
      </article>
      <p v-if="!rows.length" class="field-help">暂无讨论</p></template
    >
  </div>
</template>
<style scoped>
.discussion-panel {
  padding: 20px;
  display: grid;
  gap: 18px;
  font-size: 12px;
}
.discussion-panel article {
  border: 1px solid #e2e7ef;
  padding: 14px;
  border-radius: 8px;
  overflow-wrap: anywhere;
}
.discussion-panel label {
  display: grid;
  gap: 8px;
  color: #78889f;
}
.discussion-panel textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid #dce3ed;
  border-radius: 6px;
  padding: 9px;
  font: inherit;
  color: #40516c;
}
.discussion-panel p {
  white-space: pre-wrap;
  line-height: 1.8;
}
.discussion-panel small {
  float: right;
  color: #8092ad;
}
.discussion-panel blockquote {
  margin: 10px 0;
  padding: 10px;
  background: #f5f7fa;
  border-left: 2px solid #c7d2e4;
}
.discussion-panel blockquote p {
  margin: 4px 0;
}
</style>
