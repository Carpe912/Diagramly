import { writeDraft } from './database';
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
export function attachAutosave(
  editor: Editor,
  onState: (message: string, error?: boolean) => void,
  storageKey = KEY,
  sync?: (document: Editor['snapshot']) => Promise<void>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    try {
      const snapshot = structuredClone(editor.snapshot);
      void writeDraft(storageKey, snapshot).then(
        async () => {
          if (!sync) {
            onState('已保存到本机草稿');
            return;
          }
          try {
            await sync(snapshot);
            onState('已保存到服务端');
          } catch (e) {
            onState(
              `本机草稿已保留，服务端未保存：${e instanceof Error ? e.message : '请重新读取核对'}`,
              true,
            );
          }
        },
        () => onState('草稿保存失败，请导出备份', true),
      );
    } catch {
      onState('本机保存失败，请导出备份', true);
    }
  };
  const unsubscribe = editor.subscribe(() => {
    onState('保存中…');
    clearTimeout(timer);
    save();
  });
  window.addEventListener('pagehide', save);
  // 新建或导入的文档在首次编辑前也需要持久化。
  save();
  return () => {
    save();
    unsubscribe();
    window.removeEventListener('pagehide', save);
  };
}
export function downloadDocument(editor: Editor) {
  const blob = new Blob([JSON.stringify(editor.snapshot, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${editor.snapshot.title}.diagramly.json`);
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
