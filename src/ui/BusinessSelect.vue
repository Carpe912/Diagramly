<script setup lang="ts">
import { computed } from 'vue';
import type { BusinessOption } from '../domain/business';
const props = defineProps<{
  label: string;
  value: string | string[];
  options: BusinessOption[];
  multiple?: boolean;
  remote: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ change: [value: string | string[]] }>();
const selectionModel = computed({
  get: () => props.value,
  set: (value: string | string[]) => emit('change', value),
});
const selected = computed(() =>
  Array.isArray(props.value) ? props.value : props.value ? [props.value] : [],
);
const choices = computed(() => [
  ...props.options,
  ...selected.value
    .filter((id) => !props.options.some((o) => o.value === id))
    .map((value) => ({ value, label: '当前关联项（请加载名称）' })),
]);
</script>
<template>
  <label
    >{{ label }}
    <select
      v-if="remote"
      :aria-label="label"
      v-model="selectionModel"
      :multiple="multiple"
      :disabled="disabled"
    >
      <option v-if="!multiple" value="">未选择</option>
      <option v-for="item in choices" :key="item.value" :value="item.value">
        {{ item.label }}
      </option>
    </select>
    <input
      v-else
      :aria-label="label"
      :value="Array.isArray(value) ? value.join('、') : value"
      :disabled="disabled"
      :placeholder="multiple ? '多个项目用顿号分隔' : '填写名称'"
      @change="
        emit(
          'change',
          multiple
            ? ($event.target as HTMLInputElement).value
                .split(/[、,，]/)
                .map((s) => s.trim())
                .filter(Boolean)
            : ($event.target as HTMLInputElement).value,
        )
      "
    />
  </label>
</template>
