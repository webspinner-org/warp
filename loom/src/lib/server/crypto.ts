// AES-GCM-256 with a workspace-managed master key. Phase 1 scope: the master
// key is read from process.env.WARP_VAULT_MASTER_KEY at runtime. Phase 2
// replaces this with passphrase-unlock + Argon2id KDF + per-collection HKDF;
// the wire format below (base64 ciphertext + base64 12-byte IV) stays the
// same so stored records don't need re-encryption.

export interface EncryptedValue {
  readonly ciphertext: string;
  readonly iv: string;
}

const KEY_LEN_BYTES = 32;
const IV_LEN_BYTES = 12;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

async function importMasterKey(rawBase64: string): Promise<CryptoKey> {
  const bytes = base64Decode(rawBase64);
  if (bytes.byteLength !== KEY_LEN_BYTES) {
    throw new Error(`Master key must be ${KEY_LEN_BYTES} bytes; got ${bytes.byteLength}`);
  }
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptValue(
  masterKeyBase64: string,
  plaintext: string,
): Promise<EncryptedValue> {
  const key = await importMasterKey(masterKeyBase64);
  const iv = new Uint8Array(new ArrayBuffer(IV_LEN_BYTES));
  crypto.getRandomValues(iv);
  const data = new Uint8Array(new ArrayBuffer(TEXT_ENCODER.encode(plaintext).byteLength));
  data.set(TEXT_ENCODER.encode(plaintext));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return {
    ciphertext: base64Encode(new Uint8Array(cipher)),
    iv: base64Encode(iv),
  };
}

export async function decryptValue(
  masterKeyBase64: string,
  encrypted: EncryptedValue,
): Promise<string> {
  const key = await importMasterKey(masterKeyBase64);
  const iv = base64Decode(encrypted.iv);
  const cipher = base64Decode(encrypted.ciphertext);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return TEXT_DECODER.decode(plain);
}

function base64Encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64Decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
