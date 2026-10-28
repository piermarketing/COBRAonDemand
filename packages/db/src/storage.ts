import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./client";

/**
 * Document storage. Local filesystem in development; Cloud Storage with a
 * bucket retention policy in production (DOCUMENT_STORAGE=gcs,
 * DOCUMENT_BUCKET=<bucket>). Paths are content-addressed
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

/** Cloud Storage: bucket with versioning and a retention policy (see infra/terraform). Objects are never overwritten. */
function gcsStore(bucketName: string): DocumentStore {
  let bucket: import("@google-cloud/storage").Bucket | null = null;
  const get = async () => {
    if (!bucket) {
      const { Storage } = await import("@google-cloud/storage");
      bucket = new Storage().bucket(bucketName);
    }
    return bucket;
  };
  return {
    async put(key, bytes) {
      assertSafeKey(key);
      const file = (await get()).file(key);
      try {
        await file.save(Buffer.from(bytes), { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, contentType: "application/pdf" });
      } catch (err) {
        // 412 = object already exists; keys are content hashes, so it's the same bytes.
        if ((err as { code?: number }).code !== 412) throw err;
      }
    },
    async get(key) {
      assertSafeKey(key);
      const [data] = await (await get()).file(key).download();
      return new Uint8Array(data);
    },
  };
}

export function documentStore(): DocumentStore {
  if (process.env.DOCUMENT_STORAGE === "gcs") {
    const bucket = process.env.DOCUMENT_BUCKET;
    if (!bucket) throw new Error("DOCUMENT_BUCKET is required when DOCUMENT_STORAGE=gcs");
    return gcsStore(bucket);
  }
  return localStore;
}
