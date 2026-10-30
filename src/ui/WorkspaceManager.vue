<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { uuid } from '../domain/model';
import BusinessDialog from './BusinessDialog.vue';
import {
  request,
  login,
  downloadAttachment,
  hasServerSession,
  identifyServerSession,
} from '../adapters/server/client';
const emit = defineEmits<{ close: [] }>();
const tab = ref('business'),
  kind = ref('roles'),
  role = ref('viewer'),
  username = ref(''),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const rows = ref<Record<string, any>[]>([]),
  name = ref(''),
  description = ref(''),
  editing = ref<Record<string, any>>(),
  newPassword = ref(''),
  ownPassword = ref(''),
  newUsername = ref(''),
  newRole = ref('editor'),
  deleting = ref<Record<string, any>>();
const tableOptions = ref<{ id: string; name: string }[]>([]),
  tableIds = ref<string[]>([]),
  fields = ref<{ id: string; name: string }[]>([]);
const kinds = [
  ['roles', '角色'],
  ['applications', '应用'],
  ['devices', '设备'],
  ['operations', '操作方式'],
  ['terminals', '终端'],
  ['interfaces', '接口设计'],
  ['objects', '数据对象'],
  ['tables', '数据表'],
  ['statements', '单证'],
  ['requirements', '需求'],
  ['todos', '待办'],
];
async function action(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    busy.value = false;
  }
}
async function load() {
  if (tab.value === 'business' && kind.value === 'objects')
    tableOptions.value = await request('/business/tables');
  rows.value = await request(
    tab.value === 'business'
      ? `/business/${kind.value}`
      : tab.value === 'attachments'
        ? '/attachments'
        : '/users',
  );
}
async function changeTab(value: string) {
  tab.value = value;
  editing.value = undefined;
  deleting.value = undefined;
  await action(load);
}
onMounted(
  () =>
    void action(async () => {
      if (!hasServerSession()) throw new Error('请先在文档库登录独立服务');
      const session = await request('/session');
      role.value = session.role;
      username.value = session.username;
      await load();
    }),
);
async function save() {
  await action(async () => {
    await request(`/business/${kind.value}/${editing.value?.id ?? uuid()}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: name.value,
        description: description.value,
        data:
          kind.value === 'objects'
            ? { tableIds: tableIds.value }
            : kind.value === 'tables'
              ? { fields: fields.value }
              : (editing.value?.data ?? {}),
        expectedRevision: editing.value?.revision ?? 0,
      }),
    });
    editing.value = undefined;
    name.value = '';
    description.value = '';
    tableIds.value = [];
    fields.value = [];
    await load();
  });
}
async function remove() {
  if (!deleting.value) return;
  await action(async () => {
    await request(
      tab.value === 'attachments'
        ? `/attachments/${deleting.value!.id}`
        : `/business/${kind.value}/${deleting.value!.id}?expectedRevision=${deleting.value!.revision}`,
      { method: 'DELETE' },
    );
    deleting.value = undefined;
    await load();
  });
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  await action(async () => {
    if (file.size > 6 * 1024 * 1024) throw new Error('附件不能超过6MB');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
    await request('/attachments', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, mime: file.type, data }),
    });
    await load();
  });
  input.value = '';
}
async function addUser() {
  await action(async () => {
    await request('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: newUsername.value,
        password: newPassword.value,
        role: newRole.value,
      }),
    });
    newPassword.value = '';
    newUsername.value = '';
    await load();
  });
}
async function changePassword() {
  await action(async () => {
    await request('/password', {
      method: 'POST',
      body: JSON.stringify({ password: ownPassword.value }),
    });
    login(username.value, ownPassword.value);
    await identifyServerSession();
    ownPassword.value = '';
    notice.value = '密码已修改';
  });
}
async function updateUser(row: Record<string, any>, active: boolean) {
  await action(async () => {
    await request(`/users/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: row.revision, role: row.role, active }),
    });
    await load();
  });
}
</script>
<template>
  <BusinessDialog title="工作空间管理" :busy="busy" @close="emit('close')"
    ><form
      @submit.prevent="tab === 'business' ? save() : tab === 'accounts' ? addUser() : undefined"
    >
      <nav class="library-actions">
        <button type="button" class="button secondary" @click="changeTab('business')">
          业务数据</button
        ><button type="button" class="button secondary" @click="changeTab('attachments')">
          附件</button
        ><button
          v-if="role === 'admin'"
          type="button"
          class="button secondary"
          @click="changeTab('accounts')"
        >
          账号
        </button>
      </nav>
      <template v-if="tab === 'business'"
        ><label
          >数据类型<select
            v-model="kind"
            :disabled="busy"
            @change="
              editing = undefined;
              name = '';
              description = '';
              tableIds = [];
              fields = [];
              action(load);
            "
          >
            <option v-for="[value, label] in kinds" :key="value" :value="value">{{ label }}</option>
          </select></label
        >
        <fieldset v-if="role !== 'viewer'" :disabled="busy" class="manager-fields">
          <label>名称<input v-model="name" required maxlength="160" /></label
          ><label>说明<textarea v-model="description" rows="3" maxlength="10000" /></label
          ><label v-if="kind === 'objects'"
            >关联数据表<select v-model="tableIds" multiple>
              <option v-for="table in tableOptions" :key="table.id" :value="table.id">
                {{ table.name }}
              </option>
            </select></label
          >
          <section v-if="kind === 'tables'">
            <h4>数据表字段</h4>
            <label v-for="field in fields" :key="field.id"
              >字段名称<input v-model="field.name" required maxlength="160" /><button
                type="button"
                class="quiet-button"
                @click="fields = fields.filter((row) => row.id !== field.id)"
              >
                移除字段
              </button></label
            ><button
              type="button"
              class="button secondary"
              @click="fields.push({ id: uuid(), name: '' })"
            >
              添加字段
            </button>
          </section>
          <button class="button primary">{{ editing ? '保存修改' : '新增记录' }}</button
          ><button
            v-if="editing"
            type="button"
            class="button secondary"
            @click="
              editing = undefined;
              name = '';
              description = '';
            "
          >
            取消编辑
          </button>
        </fieldset></template
      >
      <template v-if="tab === 'attachments'"
        ><label v-if="role !== 'viewer'"
          >上传附件（最大6MB）<input type="file" :disabled="busy" @change="upload" /></label
      ></template>
      <template v-if="tab === 'accounts'"
        ><div class="form-grid">
          <label>用户名<input v-model="newUsername" pattern="[a-zA-Z0-9_-]{1,80}" required /></label
          ><label
            >角色<select v-model="newRole">
              <option value="editor">编辑者</option>
              <option value="viewer">只读用户</option>
              <option value="admin">管理员</option>
            </select></label
          >
        </div>
        <label
          >初始密码<input
            v-model="newPassword"
            type="password"
            minlength="12"
            maxlength="200"
            autocomplete="new-password"
            required /></label
        ><button class="button primary" :disabled="busy">新增账号</button></template
      >
      <article v-for="row in rows" :key="row.id" class="manager-row">
        <div>
          <strong>{{ row.name ?? row.username }}</strong>
          <p v-if="row.description" class="field-help">{{ row.description }}</p>
        </div>
        <div class="library-actions">
          <template v-if="tab === 'business' && role !== 'viewer'"
            ><button
              type="button"
              class="quiet-button"
              :disabled="busy"
              @click="
                editing = row;
                name = row.name;
                description = row.description;
                tableIds = row.data?.tableIds ?? [];
                fields = JSON.parse(JSON.stringify(row.data?.fields ?? []));
              "
            >
              编辑</button
            ><button type="button" class="quiet-button" :disabled="busy" @click="deleting = row">
              删除
            </button></template
          ><template v-if="tab === 'attachments'"
            ><button
              type="button"
              class="quiet-button"
              @click="action(() => downloadAttachment(row.id, row.name))"
            >
              下载</button
            ><button
              v-if="role !== 'viewer'"
              type="button"
              class="quiet-button"
              @click="deleting = row"
            >
              删除
            </button></template
          ><template v-if="tab === 'accounts'"
            ><select v-model="row.role" :disabled="busy">
              <option value="admin">管理员</option>
              <option value="editor">编辑者</option>
              <option value="viewer">只读用户</option></select
            ><button type="button" class="quiet-button" @click="updateUser(row, row.active)">
              保存角色</button
            ><button type="button" class="quiet-button" @click="updateUser(row, !row.active)">
              {{ row.active ? '停用' : '启用' }}
            </button></template
          >
        </div>
      </article>
      <p v-if="!rows.length" class="field-help">暂无记录</p>
      <section v-if="deleting">
        <p>确认删除「{{ deleting.name }}」？</p>
        <button type="button" class="button secondary" @click="deleting = undefined">取消</button
        ><button type="button" class="button primary" :disabled="busy" @click="remove">
          确认删除
        </button>
      </section>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <footer>
        <button type="button" class="button secondary" @click="emit('close')">关闭</button>
      </footer>
    </form>
    <form v-if="username" @submit.prevent="changePassword">
      <h3>修改本人密码</h3>
      <label
        >新密码<input
          v-model="ownPassword"
          type="password"
          minlength="12"
          maxlength="200"
          required
          autocomplete="new-password" /></label
      ><button class="button secondary" :disabled="busy">修改密码</button>
    </form>
  </BusinessDialog>
</template>
<style scoped>
.library-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.manager-fields {
  border: 0;
  padding: 0;
  display: grid;
  gap: 14px;
  min-width: 0;
}
.manager-row {
  border: 1px solid #e3e9f1;
  border-radius: 8px;
  padding: 12px;
  display: grid;
  gap: 10px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.manager-row strong {
  font-weight: 500;
}
.manager-row select {
  width: auto;
}
</style>
