import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./client";

/**
 * Document storage. Local filesystem in development; Cloud Storage with a
 * bucket retention policy in production (swap in by setting
 * DOCUMENT_STORAGE=gcs once the adapter is wired). Paths are content-addressed
 * by the caller so a stored document can't be silently replaced.
 */

export interface DocumentStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

function assertSafeKey(key: string) {
  if (key.includes("..") || path.isAbsolute(key)) throw new Error("Invalid storage key");
}

export const localStore: DocumentStore = {
  async put(key, bytes) {
    assertSafeKey(key);
    const file = path.join(dataDir(), "documents", key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx" }).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== "EEXIST") throw err;
    });
  },
  async get(key) {
    assertSafeKey(key);
    return new Uint8Array(await readFile(path.join(dataDir(), "documents", key)));
  },
};

export function documentStore(): DocumentStore {
  if (process.env.DOCUMENT_STORAGE === "gcs") {
    throw new Error("Cloud Storage adapter not wired yet: set DOCUMENT_STORAGE=local or implement the GCS store");
  }
  return localStore;
}
