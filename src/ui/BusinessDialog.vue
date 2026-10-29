<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { X } from '@lucide/vue';
defineProps<{ title: string; busy?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
let previous: HTMLElement | null;
onMounted(async () => {
  previous = document.activeElement as HTMLElement;
  await nextTick();
  dialog.value?.showModal();
});
onBeforeUnmount(() => previous?.focus());
</script>
<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="business-dialog"
      :aria-label="title"
      @cancel.prevent="!busy && emit('close')"
    >
      <header>
        <div>
          <span>业务详情</span>
          <h2>{{ title }}</h2>
        </div>
        <button
          type="button"
          class="quiet-button"
          :disabled="busy"
          aria-label="关闭业务弹窗"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </header>
      <slot />
    </dialog>
  </Teleport>
</template>
<style>
.business-dialog {
  border: 1px solid #e1e7ef;
  border-radius: 14px;
  padding: 0;
  width: min(560px, calc(100vw - 40px));
  max-height: calc(100vh - 64px);
  color: #40516c;
  box-shadow: 0 20px 70px #253b6133;
}
.business-dialog::backdrop {
  background: #24334b55;
}
.business-dialog > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #edf0f5;
}
.business-dialog header span {
  font-size: 11px;
  color: #8a99af;
}
.business-dialog h2 {
  margin: 5px 0 0;
  font-size: 17px;
}
.business-dialog form {
  padding: 22px 24px;
  display: grid;
  gap: 18px;
}
.business-dialog label {
  display: grid;
  gap: 8px;
  font-size: 12px;
  color: #6e7f98;
}
.business-dialog input:not([type='checkbox']),
.business-dialog textarea,
.business-dialog select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dae2ee;
  background: white;
  border-radius: 6px;
  padding: 9px 11px;
  color: #40516c;
  font: inherit;
  min-height: 38px;
}
.business-dialog textarea {
  resize: vertical;
  line-height: 1.7;
}
.business-dialog .toggle-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.business-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid #edf0f5;
}
.business-dialog .form-error {
  color: #b54c54;
  font-size: 12px;
  margin: 0;
  line-height: 1.6;
}
.business-dialog .form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
@media (max-width: 500px) {
  .business-dialog .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
