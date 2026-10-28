import type { Editor } from '../../application/editor';
import type { ShapeRegistry } from '../../shapes/registry';
import { documentSchema } from '../../domain/model';
import { upgradeStandaloneLanes } from '../../domain/pools';
import { validateDocument } from '../../domain/validation';

const KEY = 'diagramly.document.v1';
const MAX_BYTES = 5 * 1024 * 1024;
export function parseDocument(text: string, registry: ShapeRegistry) {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('文档超过 5MB 上限');
  return validateDocument(upgradeStandaloneLanes(documentSchema.parse(JSON.parse(text))), registry);
}
export function loadLocal(registry: ShapeRegistry) {
  const text = localStorage.getItem(KEY);
  return text ? parseDocument(text, registry) : null;
}
export function attachAutosave(editor: Editor, onState: (message: string, error?: boolean) => void, storageKey = KEY) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    try { localStorage.setItem(storageKey, JSON.stringify(editor.snapshot)); onState('已保存到本机'); }
    catch { onState('本机保存失败，请导出备份', true); }
  };
  const unsubscribe = editor.subscribe(() => { onState('保存中…'); clearTimeout(timer); timer = setTimeout(save, 400); });
  window.addEventListener('pagehide', save);
  // Persist newly imported/new documents even before the first edit.
  save();
  return () => { save(); unsubscribe(); window.removeEventListener('pagehide', save); };
}
export function downloadDocument(editor: Editor) {
  const blob = new Blob([JSON.stringify(editor.snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `${editor.snapshot.title.replace(/[\\/:*?"<>|]/g, '_')}.diagramly.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
