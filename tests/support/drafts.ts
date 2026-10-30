import type { Page } from '@playwright/test';
export async function readStoredDraft(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('diagramly', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get('diagramly.document.v1');
      request.onsuccess = () => {
        resolve(request.result ?? null);
        db.close();
      };
      request.onerror = () => {
        reject(request.error);
        db.close();
      };
    });
  });
}
