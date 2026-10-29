<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import BusinessDialog from './BusinessDialog.vue';
import type { ActivityOptions, BusinessMutation } from '../adapters/coopwire/api';
const props = defineProps<{
  kind: 'io' | 'exception';
  item: Record<string, unknown>;
  options?: ActivityOptions;
  save: (mutation: BusinessMutation) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
// 保留完整原始记录，编辑基础字段时不丢失附件、表字段和其他业务元数据。
const draft = reactive({
  ...JSON.parse(JSON.stringify(props.item)),
  name: String(props.item.name ?? ''),
  desc: String(props.item.desc ?? ''),
  exceptionDesc: String(props.item.exceptionDesc ?? ''),
  resolveMethod: String(props.item.resolveMethod ?? ''),
  exceptionRate: Number(props.item.exceptionRate ?? 0),
  isSystemOrDeviceException: props.item.isSystemOrDeviceException === true,
  systemOrDeviceId: String(props.item.systemOrDeviceId ?? ''),
  depDevice: String(props.item.depDevice ?? ''),
  objectOperateType: String(props.item.objectOperateType ?? ''),
});
const busy = ref(false),
  error = ref('');
const title = computed(
  () =>
    `${props.item.id ? '编辑' : '添加'}${props.kind === 'exception' ? '异常' : props.item.type === 'input' ? '输入' : '输出'}`,
);
const metadata = computed(() =>
  [
    ['attachmentIds', '关联附件'],
    ['attachments', '附件'],
    ['statements', '使用表单 / 单证'],
    ['dataTablesWithChoosedFields', '关联数据表'],
  ]
    .map(([key, label]) => ({
      key,
      label,
      items: Array.isArray(props.item[key]) ? (props.item[key] as unknown[]) : [],
    }))
    .filter((group) => group.items.length),
);
function recordLabel(item: unknown, index: number) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const row = item as Record<string, unknown>;
    return String(row.name ?? row.tableName ?? row.fileName ?? row.title ?? `关联项 ${index + 1}`);
  }
  return `关联项 ${index + 1}`;
}
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await props.save({ kind: props.kind, action: 'save', data: { ...draft } });
    emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请核对远程数据后重试';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <BusinessDialog :title="title" :busy="busy" @close="emit('close')">
    <form @submit.prevent="submit">
      <fieldset :disabled="busy" class="resource-fields">
        <template v-if="kind === 'io'">
          <label
            >名称<input v-model="draft.name" aria-label="输入输出名称" maxlength="500" required
          /></label>
          <label
            >描述<textarea
              v-model="draft.desc"
              aria-label="输入输出描述"
              rows="4"
              required
              maxlength="100000"
            />
          </label>
          <div class="form-grid">
            <label
              >依赖设备<select v-model="draft.depDevice">
                <option value="">未选择</option>
                <option
                  v-for="device in options?.devices"
                  :key="device.value"
                  :value="device.value"
                >
                  {{ device.label }}
                </option>
              </select></label
            >
            <label v-if="item.type === 'output'"
              >对象操作类型<select v-model="draft.objectOperateType">
                <option value="">未选择</option>
                <option value="add">新增数据</option>
                <option value="update">修改数据</option>
                <option value="del">删除数据</option>
                <option value="other">其他</option>
              </select></label
            >
          </div>
          <details v-if="metadata.length" class="resource-metadata">
            <summary>已关联业务资料</summary>
            <div v-for="group in metadata" :key="group.key">
              <h4>{{ group.label }} · {{ group.items.length }}</h4>
              <ul>
                <li v-for="(row, index) in group.items" :key="index">
                  {{ recordLabel(row, index) }}
                </li>
              </ul>
            </div>
          </details>
        </template>
        <template v-else>
          <label
            >异常描述<textarea
              v-model="draft.exceptionDesc"
              aria-label="异常描述"
              rows="4"
              required
              maxlength="100000"
            />
          </label>
          <label
            >解决方法<textarea
              v-model="draft.resolveMethod"
              aria-label="异常解决方法"
              rows="3"
              required
              maxlength="100000"
            />
          </label>
          <label
            >发生概率（%）<input
              v-model.number="draft.exceptionRate"
              aria-label="异常概率"
              type="number"
              min="0"
              max="100"
              step="0.1"
              required
          /></label>
          <label class="toggle-label"
            >应用或设备异常<input v-model="draft.isSystemOrDeviceException" type="checkbox"
          /></label>
          <label v-if="draft.isSystemOrDeviceException"
            >应用 / 设备<select v-model="draft.systemOrDeviceId" required>
              <option value="">请选择</option>
              <optgroup label="应用">
                <option v-for="row in options?.applications" :key="row.value" :value="row.value">
                  {{ row.label }}
                </option>
              </optgroup>
              <optgroup label="设备">
                <option v-for="row in options?.devices" :key="row.value" :value="row.value">
                  {{ row.label }}
                </option>
              </optgroup>
            </select></label
          >
        </template>
      </fieldset>
      <p v-if="error" role="alert" class="form-error">{{ error }}</p>
      <footer>
        <button type="button" class="button secondary" :disabled="busy" @click="emit('close')">
          取消</button
        ><button class="button primary" :disabled="busy">{{ busy ? '正在保存…' : '保存' }}</button>
      </footer>
    </form>
  </BusinessDialog>
</template>
<style scoped>
.resource-fields {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 18px;
  min-width: 0;
}
.resource-metadata {
  border: 1px solid #e4e9f1;
  border-radius: 7px;
  padding: 12px;
  font-size: 12px;
  color: #7d8ca1;
  overflow-wrap: anywhere;
}
.resource-metadata summary {
  cursor: pointer;
}
.resource-metadata h4 {
  font-size: 11px;
  margin-bottom: 8px;
}
.resource-metadata li {
  line-height: 1.8;
}
</style>
