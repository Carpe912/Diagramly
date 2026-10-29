<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { CoopwireConfig } from '../adapters/coopwire/api';
import {
  PORTRAIT_CHANNEL,
  portraitEventSchema,
  portraitUrl,
  selectionFor,
  type LinkedChoice,
} from '../adapters/coopwire/portrait';

const props = defineProps<{ config: CoopwireConfig; origin: string }>();
const emit = defineEmits<{ chosen: [choice: LinkedChoice]; close: [] }>();
const frame = ref<HTMLIFrameElement>();
const sessionId = crypto.randomUUID();
const url = computed(() =>
  portraitUrl(
    props.origin,
    selectionFor(props.config, 'pending', 'pending', 'linkAct'),
    sessionId,
    window.location.origin,
  ),
);
const status = ref('正在加载原有引用活动选择器…');
let timer: ReturnType<typeof setTimeout>;
function receive(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || event.origin !== url.value.origin) return;
  const result = portraitEventSchema.safeParse(event.data);
  if (!result.success || result.data.sessionId !== sessionId) return;
  const message = result.data;
  if (message.type === 'ready') {
    clearTimeout(timer);
    status.value = '';
    frame.value?.contentWindow?.postMessage(
      {
        channel: PORTRAIT_CHANNEL,
        version: 1,
        sessionId,
        type: 'chooseLinked',
        requestId: 1,
        flowId: props.config.flowchartId,
      },
      url.value.origin,
    );
  } else if (message.type === 'linkedChosen' && message.requestId === 1) {
    emit('chosen', message.form);
  } else if (message.type === 'linkedCancelled' && message.requestId === 1) {
    emit('close');
  }
}
onMounted(() => {
  window.addEventListener('message', receive);
  timer = setTimeout(
    () => (status.value = '引用活动选择器尚未就绪，请检查原前端嵌入入口。'),
    15000,
  );
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  window.removeEventListener('message', receive);
});
</script>

<template>
  <div class="linked-chooser">
    <p v-if="status" role="status">{{ status }}</p>
    <iframe ref="frame" :src="url.href" title="选择引用活动" referrerpolicy="strict-origin" />
  </div>
</template>

<style scoped>
.linked-chooser {
  width: min(760px, 94vw);
  height: min(680px, 90vh);
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 12px;
  overflow: hidden;
}
.linked-chooser p {
  padding: 12px 18px;
  margin: 0;
  color: #64748b;
}
.linked-chooser iframe {
  flex: 1;
  width: 100%;
  border: 0;
}
</style>
