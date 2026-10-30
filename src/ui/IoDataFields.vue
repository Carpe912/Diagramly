<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CoopwireApi, IoOptions } from '../adapters/coopwire/api';
import BusinessSelect from './BusinessSelect.vue';
const props = defineProps<{ api: CoopwireApi; value: Record<string, unknown> }>();
const emit = defineEmits<{ patch: [value: Record<string, unknown>] }>();
const options = ref<IoOptions>(),
  loading = ref(false),
  error = ref('');
async function load(event: Event) {
  if (!(event.target as HTMLDetailsElement).open || options.value || loading.value) return;
  loading.value = true;
  try {
    options.value = await props.api.ioOptions();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取业务资料失败';
  } finally {
    loading.value = false;
  }
}
const tables = computed(() => {
  const ids =
    options.value?.objects.find((row) => row.value === props.value.dataObjectId)?.tableIds ?? [];
  return options.value?.tables.filter((row) => ids.includes(row.value)) ?? [];
});
const selections = computed(() =>
  Array.isArray(props.value.dataTablesWithChoosedFields)
    ? (props.value.dataTablesWithChoosedFields as { tableId: string; fieldIds: string[] }[])
    : [],
);
function toggleTable(id: string, checked: boolean) {
  const next = selections.value.filter((row) => row.tableId !== id);
  if (checked) next.push({ tableId: id, fieldIds: [] });
  emit('patch', {
    dataTablesWithChoosedFields: next,
    dataObjectType: next.length ? 'table' : 'object',
  });
}
function setFields(tableId: string, fieldIds: string[]) {
  emit('patch', {
    dataTablesWithChoosedFields: selections.value.map((row) =>
      row.tableId === tableId ? { ...row, fieldIds } : row,
    ),
  });
}
</script>
<template>
  <details class="io-data-fields" @toggle="load">
    <summary>关联数据、表单与附件</summary>
    <p v-if="loading" class="field-help" role="status">正在读取业务资料…</p>
    <template v-if="options">
      <p v-if="options.errors.length" class="field-help">
        {{ options.errors.join('；') }}。未编辑的关联信息会保留。
      </p>
      <BusinessSelect
        label="数据对象"
        :value="String(value.dataObjectId ?? '')"
        :options="options.objects"
        remote
        @change="
          emit('patch', {
            dataObjectId: $event,
            dataObjectType: $event ? 'object' : '',
            dataTablesWithChoosedFields: [],
          })
        "
      />
      <fieldset v-if="tables.length" class="data-tables">
        <legend>选择数据表与字段</legend>
        <div v-for="table in tables" :key="table.value" class="table-fields">
          <label class="toggle-label"
            >{{ table.label
            }}<input
              type="checkbox"
              :aria-label="`选择数据表：${table.label}`"
              :checked="selections.some((row) => row.tableId === table.value)"
              @change="
                toggleTable(table.value, ($event.target as HTMLInputElement).checked)
              " /></label
          ><BusinessSelect
            v-if="selections.some((row) => row.tableId === table.value)"
            :label="`${table.label}字段（不选表示整张表）`"
            :value="selections.find((row) => row.tableId === table.value)?.fieldIds ?? []"
            :options="table.fields"
            remote
            multiple
            @change="setFields(table.value, $event as string[])"
          />
        </div>
      </fieldset>
      <BusinessSelect
        label="使用表单 / 单证"
        :value="(value.statements as string[]) ?? []"
        :options="options.statements"
        remote
        multiple
        @change="emit('patch', { statements: $event })"
      />
      <BusinessSelect
        label="关联附件文档"
        :value="(value.attachmentIds as string[]) ?? []"
        :options="options.documents"
        remote
        multiple
        @change="emit('patch', { attachmentIds: $event })"
      />
    </template>
    <p v-if="error" class="form-error">{{ error }}</p>
  </details>
</template>
<style scoped>
.io-data-fields {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
  display: grid;
  gap: 16px;
}
.io-data-fields summary {
  cursor: pointer;
  color: #657b9c;
  font-size: 12px;
}
.io-data-fields[open] summary {
  margin-bottom: 18px;
}
.io-data-fields :deep(label) {
  margin-top: 14px;
}
.io-data-fields :deep(select[multiple]) {
  min-height: 90px;
}
.io-data-fields :deep(option) {
  padding: 5px;
}
.data-tables {
  border: 1px solid #e5eaf1;
  border-radius: 6px;
  padding: 10px;
  margin-top: 16px;
}
.data-tables legend {
  font-size: 11px;
  color: #93a0b3;
}
.table-fields + .table-fields {
  border-top: 1px solid #edf0f5;
  margin-top: 12px;
}
</style>
