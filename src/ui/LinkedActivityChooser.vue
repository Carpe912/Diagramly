<script setup lang="ts">
import type { BusinessDataApi } from '../adapters/server/business';
import { onMounted, ref, watch } from 'vue';
import type { BusinessOption } from '../domain/business';
import type { LinkedChoice } from '../domain/business';
import BusinessDialog from './BusinessDialog.vue';
const props = defineProps<{ api: BusinessDataApi; initial?: LinkedChoice }>();
const emit = defineEmits<{ chosen: [choice: LinkedChoice]; close: [] }>();
const flows = ref<BusinessOption[]>([]),
  activities = ref<BusinessOption[]>([]);
const linkFlow = ref(''),
  linkAct = ref(''),
  showOrgName = ref(props.initial?.showOrgName ?? false),
  loading = ref(false),
  error = ref('');
onMounted(async () => {
  loading.value = true;
  try {
    flows.value = (await props.api.activityOptions()).flows;
    if (props.initial) linkFlow.value = props.initial.linkFlow;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '流程读取失败';
  } finally {
    loading.value = false;
  }
});
watch(linkFlow, async (id, _, onCleanup) => {
  let current = true;
  onCleanup(() => {
    current = false;
  });
  linkAct.value = '';
  activities.value = [];
  error.value = '';
  if (!id) return;
  loading.value = true;
  try {
    const result = await props.api.flowActivities(id);
    if (current) {
      activities.value = result;
      if (props.initial?.linkFlow === id) linkAct.value = props.initial.linkAct;
    }
  } catch (e) {
    if (current) error.value = e instanceof Error ? e.message : '活动读取失败';
  } finally {
    if (current) loading.value = false;
  }
});
</script>
<template>
  <BusinessDialog title="选择引用活动" @close="emit('close')">
    <form @submit.prevent="emit('chosen', { linkFlow, linkAct, showOrgName })">
      <label
        >关联流程<select v-model="linkFlow" aria-label="关联流程" required :disabled="loading">
          <option value="">请选择流程</option>
          <option v-for="flow in flows" :key="flow.value" :value="flow.value">
            {{ flow.label }}
          </option>
        </select></label
      >
      <label
        >引用活动<select
          v-model="linkAct"
          aria-label="引用活动"
          required
          :disabled="loading || !linkFlow"
        >
          <option value="">{{ loading ? '正在加载…' : '请选择活动' }}</option>
          <option v-for="act in activities" :key="act.value" :value="act.value">
            {{ act.label }}
          </option>
        </select></label
      >
      <p v-if="linkFlow && !loading && !activities.length && !error" class="field-help">
        该流程暂无可引用活动，请选择其他流程。
      </p>
      <label class="toggle-label"
        >在图上显示关联角色<input v-model="showOrgName" type="checkbox"
      /></label>
      <p v-if="error" role="alert" class="form-error">{{ error }}</p>
      <footer>
        <button type="button" class="button secondary" @click="emit('close')">取消</button
        ><button class="button primary" :disabled="loading || !linkAct">
          {{ initial ? '保存关联' : '添加引用活动' }}
        </button>
      </footer>
    </form>
  </BusinessDialog>
</template>
