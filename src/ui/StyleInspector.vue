<script setup lang="ts">
import { computed } from 'vue';
import type { DiagramEdge, DiagramNode, EdgeAppearance } from '../domain/model';
import { edgeLineAppearance, nodeLineAppearance, stylePresets } from '../shapes/styles';
const props = defineProps<{ nodes: DiagramNode[]; edges: DiagramEdge[]; busy: boolean }>();
const emit = defineEmits<{
  change: [patch: EdgeAppearance];
  preset: [colors: { fill: string; stroke: string; font: string }];
}>();
const styles = computed(
  () =>
    [...props.nodes.map(nodeLineAppearance), ...props.edges.map(edgeLineAppearance)] as Record<
      string,
      unknown
    >[],
);
const onlyEdges = computed(() => props.edges.length > 0 && !props.nodes.length);
function value(key: keyof EdgeAppearance) {
  const values = styles.value.map((style) => style[key]);
  return values.every((v) => v === values[0]) ? values[0] : undefined;
}
function update(key: keyof EdgeAppearance, value: unknown) {
  emit('change', { [key]: value } as EdgeAppearance);
}
const text = (event: Event) => (event.target as HTMLInputElement).value;
const number = (event: Event) => Number(text(event));
const disabled = computed(() => props.busy || value('strokeEnabled') === false);
const markerOptions = [
  ['none', '无'],
  ['classic', '经典箭头'],
  ['block', '三角箭头'],
  ['open', '开放箭头'],
  ['oval', '圆形'],
  ['diamond', '菱形'],
  ['classicThin', '细经典箭头'],
  ['blockThin', '细三角箭头'],
  ['openThin', '细开放箭头'],
  ['diamondThin', '细菱形'],
];
const simpleArrow = computed(
  () => onlyEdges.value && styles.value.some((s) => s.shape === 'simple-arrow'),
);
const blockArrow = computed(
  () => onlyEdges.value && styles.value.some((s) => s.shape === 'block-arrow'),
);
const availableMarkers = computed(() =>
  blockArrow.value ? markerOptions.filter(([id]) => ['none', 'block'].includes(id)) : markerOptions,
);
const canCurve = computed(() => onlyEdges.value && styles.value.every((s) => s.shape === 'line'));
const endpointControls = computed(
  () =>
    onlyEdges.value && styles.value.every((s) => s.shape === 'line' || s.shape === 'block-arrow'),
);
const canJump = computed(
  () => onlyEdges.value && styles.value.every((s) => s.shape === 'line' && s.corner !== 'curved'),
);
const showCorner = computed(
  () =>
    props.edges.length > 0 ||
    props.nodes.some((n) => !['ellipse', 'start', 'end'].includes(n.type)),
);
</script>
<template>
  <section class="property-section style-inspector" aria-label="图形与线条样式">
    <h3>
      样式<span v-if="styles.length > 1">批量设置 {{ styles.length }} 个元素</span>
    </h3>
    <div class="style-presets">
      <button
        v-for="preset in stylePresets"
        :key="preset.name"
        :aria-label="`应用${preset.name}样式`"
        :title="preset.name"
        :style="{ background: preset.fill, borderColor: preset.stroke }"
        :disabled="busy"
        @click="emit('preset', preset)"
      ></button>
    </div>
    <label class="toggle-label"
      ><span>{{ onlyEdges ? '显示线条' : '显示边框／线条' }}</span
      ><input
        type="checkbox"
        aria-label="显示线条"
        :checked="value('strokeEnabled') !== false"
        :indeterminate="value('strokeEnabled') === undefined"
        :disabled="busy"
        @change="update('strokeEnabled', ($event.target as HTMLInputElement).checked)"
    /></label>
    <fieldset :disabled="disabled">
      <div class="style-pair">
        <label
          >颜色<input
            type="color"
            aria-label="线条颜色"
            :value="value('strokeColor') ?? '#8e99ad'"
            @change="update('strokeColor', text($event))" /></label
        ><label
          >宽度（pt）<input
            type="number"
            min="0.1"
            max="999"
            step="0.5"
            aria-label="线条宽度"
            :value="value('strokeWidth') ?? ''"
            @change="update('strokeWidth', number($event))"
        /></label>
      </div>
      <label
        >线条样式<select
          aria-label="线条样式"
          :value="value('pattern') ?? ''"
          @change="update('pattern', text($event))"
        >
          <option disabled value="">多种值</option>
          <option value="solid">实线</option>
          <option value="dashed">虚线</option>
          <option value="dotted">点线 · 紧密</option>
          <option value="dotted-spaced">点线 · 标准</option>
          <option value="dotted-wide">点线 · 稀疏</option>
        </select></label
      >
      <label v-if="showCorner && !simpleArrow"
        >转角<select
          aria-label="转角样式"
          :value="value('corner') ?? ''"
          @change="update('corner', text($event))"
        >
          <option disabled value="">多种值</option>
          <option value="sharp">锐利</option>
          <option value="rounded">圆角</option>
          <option v-if="canCurve" value="curved">曲线</option>
        </select></label
      >
      <template v-if="onlyEdges">
        <label
          >线段形态<select
            aria-label="线段形态"
            :value="value('shape') ?? ''"
            @change="update('shape', text($event))"
          >
            <option disabled value="">多种值</option>
            <option value="line">普通连线</option>
            <option value="link">双线链接</option>
            <option value="block-arrow">块箭头</option>
            <option value="simple-arrow">简单箭头</option>
          </select></label
        >
        <label
          >连接路径<select
            aria-label="连接路径"
            :disabled="simpleArrow"
            :value="value('routing') ?? ''"
            @change="update('routing', text($event))"
          >
            <option disabled value="">多种值</option>
            <option value="straight">直线</option>
            <option value="orthogonal">正交折线</option>
            <option value="elbow-horizontal">水平肘形</option>
            <option value="elbow-vertical">垂直肘形</option>
            <option value="entity">实体关系</option>
          </select></label
        >
        <div class="endpoint-styles" v-for="end in ['start', 'end'] as const" :key="end">
          <h4>{{ end === 'start' ? '线始端' : '线末端' }}</h4>
          <label
            >端点形状<select
              :aria-label="end === 'start' ? '线始端形状' : '线末端形状'"
              :value="value(end === 'start' ? 'startArrow' : 'endArrow') ?? ''"
              :disabled="!endpointControls"
              @change="update(end === 'start' ? 'startArrow' : 'endArrow', text($event))"
            >
              <option disabled value="">多种值</option>
              <option v-for="[id, label] in availableMarkers" :key="id" :value="id">
                {{ label }}
              </option>
            </select></label
          >
          <label class="toggle-label"
            ><span>填充端点</span
            ><input
              type="checkbox"
              :aria-label="end === 'start' ? '填充线始端' : '填充线末端'"
              :checked="value(end === 'start' ? 'startFill' : 'endFill') !== false"
              :disabled="
                !endpointControls ||
                blockArrow ||
                ['none', 'open', 'openThin'].includes(
                  String(value(end === 'start' ? 'startArrow' : 'endArrow')),
                )
              "
              @change="
                update(
                  end === 'start' ? 'startFill' : 'endFill',
                  ($event.target as HTMLInputElement).checked,
                )
              "
          /></label>
          <div class="style-pair">
            <label
              >大小（pt）<input
                type="number"
                min="0"
                max="999"
                :aria-label="end === 'start' ? '线始端大小' : '线末端大小'"
                :value="value(end === 'start' ? 'startSize' : 'endSize') ?? ''"
                :disabled="
                  value('shape') === 'link' ||
                  (end === 'start'
                    ? !endpointControls || value('startArrow') === 'none'
                    : !simpleArrow && (!endpointControls || value('endArrow') === 'none'))
                "
                @change="
                  update(end === 'start' ? 'startSize' : 'endSize', number($event))
                " /></label
            ><label
              >间距（pt）<input
                type="number"
                min="0"
                max="999"
                :aria-label="end === 'start' ? '线始端间距' : '线末端间距'"
                :value="value(end === 'start' ? 'startSpacing' : 'endSpacing') ?? ''"
                @change="update(end === 'start' ? 'startSpacing' : 'endSpacing', number($event))"
            /></label>
          </div>
        </div>
        <h4>跨线</h4>
        <div class="style-pair">
          <label
            >跨线样式<select
              aria-label="跨线样式"
              :value="value('jumpStyle') ?? ''"
              :disabled="!canJump"
              @change="update('jumpStyle', text($event))"
            >
              <option disabled value="">多种值</option>
              <option value="none">无</option>
              <option value="arc">圆弧</option>
              <option value="gap">间断</option>
              <option value="sharp">尖角</option>
            </select></label
          ><label
            >大小（pt）<input
              type="number"
              min="1"
              max="999"
              aria-label="跨线大小"
              :value="value('jumpSize') ?? ''"
              :disabled="!canJump || value('jumpStyle') === 'none'"
              @change="update('jumpSize', number($event))"
          /></label>
        </div>
        <p v-if="!canJump" class="field-help">
          跨线用于普通直线与折线，曲线和箭头形态使用自身轮廓。
        </p>
      </template>
    </fieldset>
    <label
      >不透明度（%）<input
        type="number"
        min="0"
        max="100"
        aria-label="图形不透明度"
        :value="value('opacity') ?? ''"
        :disabled="busy"
        @change="update('opacity', number($event))"
    /></label>
  </section>
</template>
<style scoped>
.style-inspector fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.style-presets {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 18px;
}
.style-presets button {
  height: 24px;
  border: 1px solid;
  border-radius: 3px;
}
.style-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.style-pair input[type='color'] {
  height: 32px;
  padding: 4px !important;
  cursor: pointer;
}
.style-inspector h4 {
  font-size: 10px;
  font-weight: 600;
  color: #7c8da6;
  margin: 18px 0 0;
}
.style-inspector input,
.style-inspector select {
  min-width: 0;
}
.endpoint-styles {
  padding-top: 2px;
}
.endpoint-styles + .endpoint-styles {
  border-top: 1px solid #edf0f5;
  margin-top: 15px;
}
</style>
