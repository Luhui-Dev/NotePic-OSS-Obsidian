// SHA-256 → lowercase hex, take the first 24 chars. Mirrors the
// `hashlib.sha256(data).hexdigest()[:24]` convention used by the Python uploader.
// We use the Web Crypto API which is available in Electron renderers and on
// mobile WebViews — no Node 'crypto' polyfill needed.

export async function sha256Hex24(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // crypto.subtle wants an ArrayBuffer-like view; pass a copy slice to be safe.
  const buf = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const arr = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex.slice(0, 24);
}
