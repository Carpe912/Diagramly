<script setup lang="ts">
import { computed } from 'vue';
import { Settings2, RefreshCw } from '@lucide/vue';
import BusinessSelect from './BusinessSelect.vue';
import type { BusinessEntity, DiagramNode } from '../domain/model';
import { defaultDisplaySettings, type ActivityDetails } from '../domain/activityDetails';
import type { ActivityDetail, ActivityOptions } from '../adapters/coopwire/api';
const props = defineProps<{
  entity: BusinessEntity;
  node: DiagramNode;
  busy: boolean;
  remote: boolean;
  options?: ActivityOptions;
  loadingOptions: boolean;
  related?: ActivityDetail;
}>();
const emit = defineEmits<{ patch: [patch: Partial<BusinessEntity>]; loadOptions: [] }>();
const detail = computed(() => props.entity.details ?? {});
const display = computed(() => ({ ...defaultDisplaySettings, ...detail.value.displaySetting }));
const settings = [
  ['keyStepVisible', '补充说明'],
  ['markVisible', '标记差异'],
  ['deviceVisible', '设备与工具'],
  ['timeVisible', '活动时间要求'],
  ['cycleVisible', '活动周期要求'],
] as const;
function patch(value: ActivityDetails) {
  emit('patch', { details: value });
}
const text = (event: Event) => (event.target as HTMLInputElement).value;
const checked = (event: Event) => (event.target as HTMLInputElement).checked;
const list = (event: Event) =>
  text(event)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
const plainText = (value: string) =>
  value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&');
function setRange(key: 'actTimeStart' | 'actTimeEnd', event: Event) {
  patch({
    timeRanges: {
      actTimeStart: detail.value.timeRanges?.actTimeStart ?? 9,
      actTimeEnd: detail.value.timeRanges?.actTimeEnd ?? 18,
      [key]: Number(text(event)),
    },
  });
}
function dates(event: Event) {
  return text(event)
    .split(/[,，、\s]+/)
    .filter(Boolean);
}
const relations = computed(() =>
  [
    ['exceptions', '异常'],
    ['difficulties', '痛点'],
    ['solveDifficulties', '解决的痛点'],
    ['solveFunctionItems', '关联功能'],
    ['workItemRes', '关联待办'],
    ['helps', '调研记录'],
    ['actLinkedMappings', '关联活动'],
  ].map(([key, label]) => ({
    key,
    label,
    items: Array.isArray(props.related?.[key])
      ? (props.related[key] as Record<string, unknown>[])
      : [],
  })),
);
function relationName(item: Record<string, unknown>, index: number) {
  const key = [
    'name',
    'title',
    'description',
    'desc',
    'exceptionDesc',
    'difficultDesc',
    'actName',
  ].find((key) => typeof item?.[key] === 'string' && item[key]);
  return key ? plainText(String(item[key])) : `关联记录 ${index + 1}`;
}
</script>
<template>
  <div class="activity-details" data-testid="activity-details">
    <div class="portrait-heading">
      <div>
        <span>活动画像</span><strong>{{ entity.name }}</strong>
      </div>
      <details class="display-picker">
        <summary><Settings2 :size="14" />显示设置</summary>
        <div>
          <label v-for="[key, label] in settings" :key="key"
            ><span>{{ label }}</span
            ><input
              type="checkbox"
              :aria-label="`显示${label}`"
              :checked="display[key]"
              :disabled="busy"
              @change="patch({ displaySetting: { [key]: checked($event) } })"
          /></label>
        </div>
      </details>
    </div>
    <fieldset :disabled="busy">
      <section class="property-section">
        <h3>
          基本信息<span>{{ entity.code }}</span>
        </h3>
        <label
          >活动名称<input
            aria-label="活动名称"
            :value="entity.name"
            @change="emit('patch', { name: text($event) })"
        /></label>
        <label v-if="node.type === 'activity'"
          >活动类型<select
            aria-label="详情活动类型"
            :value="entity.activityType"
            @change="
              emit('patch', { activityType: text($event) as BusinessEntity['activityType'] })
            "
          >
            <option value="manual">人工线上</option>
            <option value="offline">人工线下</option>
            <option value="system">系统操作</option>
            <option value="interface">接口对接</option>
            <option value="linked">引用活动</option>
          </select></label
        >
        <label v-else
          >图形类型<input :value="node.type === 'decision' ? '条件判断' : '子流程'" readonly
        /></label>
        <label
          >活动详细描述<textarea
            aria-label="活动详细描述"
            rows="4"
            :value="entity.description"
            @change="emit('patch', { description: text($event) })"
          ></textarea>
        </label>
        <label class="toggle-label"
          ><span>在图上显示描述</span
          ><input
            type="checkbox"
            aria-label="在图上显示描述"
            :checked="detail.showInFlow ?? false"
            @change="patch({ showInFlow: checked($event) })"
        /></label>
        <label class="toggle-label"
          ><span>关键活动</span
          ><input
            type="checkbox"
            aria-label="详情关键活动"
            :checked="entity.critical"
            @change="emit('patch', { critical: checked($event) })"
        /></label>
        <label
          >进度（%）<input
            type="number"
            min="0"
            max="100"
            aria-label="活动进度"
            :value="detail.progressRate ?? 0"
            @change="patch({ progressRate: Number(text($event)) })"
        /></label>
      </section>
      <section v-if="display.keyStepVisible" class="property-section">
        <h3>补充说明</h3>
        <textarea
          aria-label="补充说明"
          rows="4"
          :value="plainText(detail.keyStep ?? '')"
          placeholder="填写关键步骤与补充信息"
          @change="patch({ keyStep: text($event) })"
        ></textarea>
      </section>
      <section v-if="display.markVisible" class="property-section">
        <h3>标记差异</h3>
        <div class="diff-options">
          <label v-for="value in ['无', '新增', '优化', '删除']" :key="value"
            ><input
              type="radio"
              name="mark-difference"
              :aria-label="`差异${value}`"
              :checked="(detail.markDiffWithCurrent || '无') === value"
              @change="
                patch({ markDiffWithCurrent: value as ActivityDetails['markDiffWithCurrent'] })
              "
            />{{ value }}</label
          >
        </div>
      </section>
      <section
        v-if="node.type === 'subprocess' || entity.activityType !== 'interface'"
        class="property-section"
      >
        <h3>
          应用与设备<button
            v-if="remote"
            class="quiet-button"
            :disabled="loadingOptions"
            @click="emit('loadOptions')"
          >
            <RefreshCw :size="12" />{{ loadingOptions ? '加载中…' : '加载业务选项' }}
          </button>
        </h3>
        <BusinessSelect
          v-if="entity.activityType !== 'offline' && node.type !== 'subprocess'"
          label="活动使用的应用"
          :value="detail.actSystemUsed ?? ''"
          :options="options?.applications ?? []"
          :remote="remote"
          @change="patch({ actSystemUsed: $event as string })"
        />
        <BusinessSelect
          v-if="node.type === 'activity' && ['manual', 'system'].includes(entity.activityType)"
          label="终端"
          :value="detail.terminals ?? []"
          :options="options?.terminals ?? []"
          :remote="remote"
          multiple
          @change="patch({ terminals: $event as string[] })"
        />
        <template v-if="display.deviceVisible || entity.activityType === 'offline'"
          ><BusinessSelect
            label="使用的设备与工具"
            :value="detail.actDevicesUsed ?? []"
            :options="options?.devices ?? []"
            :remote="remote"
            multiple
            @change="patch({ actDevicesUsed: $event as string[] })"
        /></template>
        <BusinessSelect
          v-if="entity.activityType === 'offline'"
          label="操作方式"
          :value="detail.operateTypes ?? []"
          :options="options?.operateTypes ?? []"
          :remote="remote"
          multiple
          @change="patch({ operateTypes: $event as string[] })"
        />
        <BusinessSelect
          v-if="node.type === 'subprocess'"
          label="关联流程"
          :value="detail.linkFlow ?? ''"
          :options="options?.flows ?? []"
          :remote="remote"
          @change="patch({ linkFlow: $event as string })"
        />
      </section>
      <section v-if="display.timeVisible" class="property-section">
        <h3>活动时间要求</h3>
        <label class="toggle-label"
          ><span>需要时间安排</span
          ><input
            type="checkbox"
            aria-label="需要时间安排"
            :checked="detail.needActTimeSchedule ?? false"
            @change="patch({ needActTimeSchedule: checked($event) })"
        /></label>
        <label
          >单次活动用时（小时）<input
            type="number"
            min="0"
            step="0.25"
            aria-label="单次活动用时"
            :value="detail.hoursOnceAct ?? '0'"
            @change="patch({ hoursOnceAct: text($event) })"
        /></label>
        <div class="time-range-fields">
          <label
            >开始小时<input
              type="number"
              min="0"
              max="23"
              aria-label="活动开始小时"
              :value="detail.timeRanges?.actTimeStart ?? 9"
              @change="setRange('actTimeStart', $event)" /></label
          ><span>—</span
          ><label
            >结束小时<input
              type="number"
              min="0"
              max="23"
              aria-label="活动结束小时"
              :value="detail.timeRanges?.actTimeEnd ?? 18"
              @change="setRange('actTimeEnd', $event)"
          /></label>
        </div>
        <button v-if="detail.timeRanges" class="quiet-button" @click="patch({ timeRanges: null })">
          清除时间范围
        </button>
      </section>
      <section v-if="display.cycleVisible" class="property-section">
        <h3>活动周期要求</h3>
        <label class="toggle-label"
          ><span>需要周期安排</span
          ><input
            type="checkbox"
            aria-label="需要周期安排"
            :checked="detail.needActCycleSchedule ?? false"
            @change="patch({ needActCycleSchedule: checked($event) })"
        /></label>
        <label
          >周期方式<select
            aria-label="周期方式"
            :value="detail.isFixedCycle === false ? 'flexible' : 'fixed'"
            @change="patch({ isFixedCycle: text($event) === 'fixed' })"
          >
            <option value="fixed">固定周期</option>
            <option value="flexible">非固定周期</option>
          </select></label
        >
        <template v-if="detail.isFixedCycle !== false"
          ><label
            >执行周期<select
              aria-label="执行周期"
              :value="detail.fixedCycleKey ?? ''"
              @change="patch({ fixedCycleKey: text($event) as ActivityDetails['fixedCycleKey'] })"
            >
              <option value="">未设置</option>
              <option value="day">每日</option>
              <option value="week">每周</option>
              <option value="month">每月</option>
            </select></label
          >
          <label v-if="detail.fixedCycleKey === 'week'"
            >星期（1—7，逗号分隔）<input
              aria-label="执行星期"
              :value="detail.fixedCycleWeekValues?.join(',') ?? ''"
              @change="patch({ fixedCycleWeekValues: dates($event) })"
          /></label>
          <label v-if="detail.fixedCycleKey === 'month'"
            >日期（1—31，逗号分隔）<input
              aria-label="执行日期"
              :value="detail.fixedCycleMonthValues?.join(',') ?? ''"
              @change="patch({ fixedCycleMonthValues: dates($event) })"
          /></label>
        </template>
        <label v-else
          >非固定周期说明<textarea
            aria-label="非固定周期说明"
            rows="3"
            :value="detail.nonFixedCycleDesc ?? ''"
            @change="patch({ nonFixedCycleDesc: text($event) })"
          ></textarea>
        </label>
      </section>
      <section class="property-section">
        <h3>输入与输出</h3>
        <label
          >输入<textarea
            aria-label="详情活动输入"
            rows="3"
            :value="entity.inputs.join('\n')"
            placeholder="每行一个输入"
            @change="emit('patch', { inputs: list($event) })"
          ></textarea></label
        ><label
          >输出<textarea
            aria-label="详情活动输出"
            rows="3"
            :value="entity.outputs.join('\n')"
            placeholder="每行一个输出"
            @change="emit('patch', { outputs: list($event) })"
          ></textarea>
        </label>
      </section>
      <section
        v-if="detail.interviewers?.length || detail.interviewees?.length"
        class="property-section"
      >
        <h3>调研</h3>
        <p class="field-help">
          已关联 {{ detail.interviewers?.length ?? 0 }} 位调研人、{{
            detail.interviewees?.length ?? 0
          }}
          位被调研人。人员关系沿用 Coopwire 数据。
        </p>
      </section>
      <section v-if="related" class="property-section">
        <h3>关联业务</h3>
        <details v-for="relation in relations" :key="relation.key" class="related-records">
          <summary>
            {{ relation.label }}<span>{{ relation.items.length }}</span>
          </summary>
          <p v-if="!relation.items.length" class="field-help">暂无关联记录</p>
          <ul v-else>
            <li v-for="(item, index) in relation.items" :key="index">
              {{ relationName(item, index) }}
            </li>
          </ul>
        </details>
      </section>
    </fieldset>
  </div>
</template>
