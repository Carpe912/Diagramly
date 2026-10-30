import type { DiagramDocument } from '../../domain/model';
let opening: Promise<IDBDatabase> | undefined;
function database() {
  return (opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('diagramly', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = undefined;
      reject(request.error);
    };
  }));
}
export async function readDraft(key = 'diagramly.document.v1'): Promise<DiagramDocument | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
export async function writeDraft(key: string, document: DiagramDocument) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put(document, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
