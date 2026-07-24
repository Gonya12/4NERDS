const databaseName = "4nerds-card-scan-drafts";
const storeName = "drafts";

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveQuickScanDraft(file: File) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, "readwrite").objectStore(storeName).put({ id: "quick-card", file, status: "analyzing", savedAt: new Date().toISOString() });
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  db.close();
}

export async function loadQuickScanDraft() {
  const db = await database();
  const value = await new Promise<{ file?: File } | undefined>((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get("quick-card");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  db.close();
  return value?.file;
}

export async function clearQuickScanDraft() {
  const db = await database();
  await new Promise<void>((resolve) => {
    const request = db.transaction(storeName, "readwrite").objectStore(storeName).delete("quick-card");
    request.onsuccess = request.onerror = () => resolve();
  });
  db.close();
}
