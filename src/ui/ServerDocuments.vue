<script setup lang="ts">
import { ref } from 'vue';
import BusinessDialog from './BusinessDialog.vue';
import { login, request, listDocuments, getDocument } from '../adapters/server/client';
import { emptyDocument, type DiagramDocument } from '../domain/model';
const emit = defineEmits<{ close: []; open: [document: DiagramDocument, revision: number] }>();
const username = ref(''),
  password = ref(''),
  authenticated = ref(false),
  busy = ref(false),
  error = ref('');
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
      <button
        v-for="row in rows"
        :key="row.id"
        type="button"
        class="button secondary"
        :disabled="busy"
        @click="open(row.id)"
      >
        {{ row.title }} · v{{ row.revision }}
      </button>
      <p v-if="!rows.length" class="field-help">暂无文档，可以新建空白画布。</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <footer><button class="button primary" :disabled="busy">新建服务端文档</button></footer>
    </form>
  </BusinessDialog>
</template>
