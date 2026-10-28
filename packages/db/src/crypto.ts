import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Field-level encryption for SSN, DOB and EIN (AES-256-GCM). In production the
 * key comes from Secret Manager / Cloud KMS via FIELD_ENCRYPTION_KEY (32 bytes,
 * base64). Development falls back to a fixed dev key so synthetic data works
 * without setup; production refuses to start without a real key.
 */

const DEV_KEY = Buffer.alloc(32, 7);
let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    cachedKey = key;
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("FIELD_ENCRYPTION_KEY is required in production");
  } else {
    cachedKey = DEV_KEY;
  }
  return cachedKey;
}

function subKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), purpose, 32));
}

const VERSION = "v1";

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subKey("field-encryption"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptField(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("Unrecognized encrypted field format");
  const decipher = createDecipheriv("aes-256-gcm", subKey("field-encryption"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** Keyed hash of SSN last 4, salted per company so equal values don't match across tenants. */
export function hashLast4(companyId: string, last4: string): string {
  return createHmac("sha256", subKey("ssn-last4")).update(`${companyId}:${last4}`).digest("hex");
}

export function hashMatches(expectedHex: string, companyId: string, last4: string): boolean {
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(hashLast4(companyId, last4), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Generic keyed hash for one-time codes. */
export function hashSecret(purpose: string, value: string): string {
  return createHmac("sha256", subKey(purpose)).update(value).digest("hex");
}
