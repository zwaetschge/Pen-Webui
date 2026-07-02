import sodium from "libsodium-wrappers-sumo";
import { env } from "./env";

let ready: Promise<void> | null = null;

async function init() {
  if (!ready) {
    ready = sodium.ready;
  }
  await ready;
}

function key(): Uint8Array {
  return sodium.from_hex(env().SECRET_BOX_KEY);
}

/** Encrypt an arbitrary UTF-8 string with libsodium secretbox.  Returns Buffer
 *  containing `nonce || ciphertext`, suitable for storing as `Bytes` in Prisma. */
export async function encryptString(plain: string): Promise<Buffer> {
  await init();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(
    sodium.from_string(plain),
    nonce,
    key(),
  );
  const out = new Uint8Array(nonce.length + cipher.length);
  out.set(nonce, 0);
  out.set(cipher, nonce.length);
  return Buffer.from(out);
}

export async function decryptString(payload: Buffer): Promise<string> {
  await init();
  const NONCE = sodium.crypto_secretbox_NONCEBYTES;
  if (payload.length <= NONCE) throw new Error("ciphertext too short");
  const nonce = payload.subarray(0, NONCE);
  const cipher = payload.subarray(NONCE);
  const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, key());
  return sodium.to_string(plain);
}
