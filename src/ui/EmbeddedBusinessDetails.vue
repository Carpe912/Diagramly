<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  PORTRAIT_CHANNEL,
  portraitEventSchema,
  portraitUrl,
  type BusinessSelection,
} from '../adapters/coopwire/portrait';
const props = defineProps<{
  selection: BusinessSelection;
  origin: string;
  busy: boolean;
  revision: number;
}>();
const emit = defineEmits<{ changed: [actId: string]; close: []; error: [error: Error] }>();
const frame = ref<HTMLIFrameElement>(),
  ready = ref(false),
  loaded = ref(false),
  failure = ref('');
const sessionId = crypto.randomUUID();
let requestId = 0,
  timer: ReturnType<typeof setTimeout> | undefined;
const url = computed(() =>
  portraitUrl(props.origin, props.selection, sessionId, window.location.origin),
);
function send(type: string, data: Record<string, unknown> = {}) {
  frame.value?.contentWindow?.postMessage(
    { channel: PORTRAIT_CHANNEL, version: 1, sessionId, type, ...data },
    url.value.origin,
  );
}
function select() {
  if (!ready.value) return;
  loaded.value = false;
  failure.value = '';
  requestId++;
  send('select', { requestId, selection: props.selection, busy: props.busy });
}
function message(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || event.origin !== url.value.origin) return;
  const parsed = portraitEventSchema.safeParse(event.data);
  if (!parsed.success || parsed.data.sessionId !== sessionId) return;
  const data = parsed.data;
  if (data.type === 'ready') {
    ready.value = true;
    clearTimeout(timer);
    select();
    return;
  }
  if (data.type === 'linkedChosen' || data.type === 'linkedCancelled') return;
  if (data.requestId !== requestId || data.actId !== props.selection.actId) return;
  if (data.type === 'loaded') {
    loaded.value = true;
    failure.value = '';
  } else if (data.type === 'changed') emit('changed', data.actId);
  else if (data.type === 'close') emit('close');
  else {
    failure.value = data.message;
    emit('error', new Error(data.message));
  }
}
function start() {
  ready.value = false;
  loaded.value = false;
  failure.value = '';
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!ready.value) failure.value = '业务面板尚未就绪，请确认 Coopwire 已部署嵌入入口后重试。';
  }, 15000);
}
function reload() {
  start();
  if (frame.value) frame.value.src = url.value.href;
}
watch(() => JSON.stringify(props.selection), select);
watch(
  () => props.busy,
  () => {
    if (ready.value) send('state', { requestId, busy: props.busy });
  },
);
watch(
  () => props.revision,
  () => {
    if (ready.value) send('refresh', { requestId, actId: props.selection.actId });
  },
);
onMounted(() => {
  window.addEventListener('message', message);
  start();
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  window.removeEventListener('message', message);
});
</script>
<template>
  <div class="embedded-business-details">
    <div class="business-identity">
      <span>业务 ID</span><code>{{ selection.actId }}</code>
    </div>
    <div v-if="failure" class="portrait-status" role="alert">
      {{ failure }}<button class="button secondary" @click="reload">重新加载业务面板</button>
    </div>
    <div v-else-if="!loaded" class="portrait-status" role="status">正在加载业务详情…</div>
    <iframe
      ref="frame"
      :src="url.href"
      title="Coopwire 业务详情"
      :aria-busy="!loaded"
      referrerpolicy="strict-origin"
    />
    <div v-if="busy" class="portrait-busy">正在同步业务与画布…</div>
  </div>
</template>
<style scoped>
.embedded-business-details {
  height: 100%;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  position: relative;
}
iframe {
  flex: 1;
  width: 100%;
  min-height: 300px;
  border: 0;
  background: white;
}
.business-identity {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid #edf0f5;
  font-size: 10px;
  color: #8694a8;
}
.business-identity code {
  overflow-wrap: anywhere;
}
.portrait-status {
  padding: 14px;
  color: #7d8da6;
  font-size: 12px;
  display: grid;
  gap: 12px;
}
.portrait-busy {
  position: absolute;
  inset: 36px 0 0;
  background: #ffffffb8;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: #677b99;
  z-index: 5;
}
</style>
