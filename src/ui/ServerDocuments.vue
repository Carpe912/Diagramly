<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BusinessDialog from './BusinessDialog.vue';
import {
  login,
  request,
  listDocuments,
  getDocument,
  hasServerSession,
} from '../adapters/server/client';
import { emptyDocument, newId, type DiagramDocument } from '../domain/model';
const emit = defineEmits<{ close: []; open: [document: DiagramDocument, revision: number] }>();
const username = ref(''),
  password = ref(''),
  authenticated = ref(hasServerSession()),
  busy = ref(false),
  error = ref('');
const search = ref(''),
  trash = ref(false);
const deleting = ref<{ id: string; title: string; revision: number }>();
const filtered = computed(() =>
  rows.value.filter((row) =>
    row.title.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()),
  ),
);
onMounted(() => {
  if (authenticated.value)
    void perform(async () => {
      rows.value = await listDocuments();
    });
});
async function refresh() {
  await perform(async () => {
    rows.value = await listDocuments(trash.value);
  });
}
async function lifecycle(row: { id: string; revision: number }, restore: boolean) {
  await perform(async () => {
    await request(`/documents/${row.id}/lifecycle`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: row.revision, restore }),
    });
    rows.value = await listDocuments(trash.value);
    deleting.value = undefined;
  });
}
async function copy(id: string) {
  await perform(async () => {
    const value = await getDocument(id);
    value.document.id = newId('doc');
    value.document.title += '（副本）';
    value.document.revision = 0;
    Object.values(value.document.entities).forEach((entity) => {
      delete entity.externalRef;
    });
    await request(`/documents/${value.document.id}`, {
      method: 'PUT',
      body: JSON.stringify({ document: value.document, expectedRevision: 0 }),
    });
    rows.value = await listDocuments();
  });
}
const rows = ref<Awaited<ReturnType<typeof listDocuments>>>([]);
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
async function signIn() {
  await perform(async () => {
    login(username.value, password.value);
    rows.value = await listDocuments();
    password.value = '';
    authenticated.value = true;
  });
}
async function open(id: string) {
  await perform(async () => {
    const value = await getDocument(id);
    emit('open', value.document, value.revision);
  });
}
async function create() {
  await perform(async () => {
    const document = emptyDocument();
    const result = await request(`/documents/${document.id}`, {
      method: 'PUT',
      body: JSON.stringify({ document, expectedRevision: 0 }),
    });
    emit('open', document, result.revision);
  });
}
</script>
<template>
  <BusinessDialog title="文档库" :busy="busy" @close="emit('close')">
    <form v-if="!authenticated" @submit.prevent="signIn">
      <label>用户名<input v-model="username" autocomplete="username" required /></label
      ><label
        >密码<input v-model="password" type="password" autocomplete="current-password" required
      /></label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <footer>
        <button class="button primary" :disabled="busy">
          {{ busy ? '正在登录…' : '登录独立服务' }}
        </button>
      </footer>
    </form>
    <form v-else @submit.prevent="create">
      <p class="field-help">
        打开后的文档自动保存到服务端，本机保留草稿副本。未保存的本机草稿不会自动上传。
      </p>
      <div class="library-actions">
        <button
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="
            trash = !trash;
            deleting = undefined;
            refresh();
          "
        >
          {{ trash ? '返回文档' : '回收站' }}</button
        ><button type="button" class="button secondary" :disabled="busy" @click="refresh">
          刷新
        </button>
      </div>
      <label>搜索文档<input v-model="search" placeholder="输入文档名称" /></label>
      <article v-for="row in filtered" :key="row.id" class="document-row">
        <button
          type="button"
          class="quiet-button document-title"
          :disabled="busy || trash"
          @click="open(row.id)"
        >
          {{ row.title }} · v{{ row.revision }}
        </button>
        <div class="library-actions">
          <template v-if="!trash"
            ><button type="button" class="quiet-button" :disabled="busy" @click="copy(row.id)">
              复制</button
            ><button type="button" class="quiet-button" :disabled="busy" @click="deleting = row">
              删除
            </button></template
          ><button
            v-else
            type="button"
            class="quiet-button"
            :disabled="busy"
            @click="lifecycle(row, true)"
          >
            恢复
          </button>
        </div>
      </article>
      <section v-if="deleting" class="delete-confirm">
        <p>将「{{ deleting.title }}」移入回收站？可以恢复。</p>
        <button
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="deleting = undefined"
        >
          取消</button
        ><button
          type="button"
          class="button primary"
          :disabled="busy"
          @click="lifecycle(deleting, false)"
        >
          确认删除
        </button>
      </section>
      <p v-if="!rows.length" class="field-help">暂无文档，可以新建空白画布。</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <footer>
        <button v-if="!trash" class="button primary" :disabled="busy">新建服务端文档</button>
      </footer>
    </form>
  </BusinessDialog>
</template>

<style scoped>
.library-actions {
  display: flex;
  gap: 8px;
}
.document-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #e3e9f1;
  border-radius: 8px;
  padding: 10px;
}
.document-title {
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: left;
}
.delete-confirm {
  padding: 14px;
  border: 1px solid #eed9d9;
  border-radius: 8px;
  font-size: 12px;
}
.delete-confirm button + button {
  margin-left: 8px;
}
</style>
