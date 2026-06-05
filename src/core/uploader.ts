// Aliyun OSS uploader. Mirrors notepic_oss/uploader.py:
//   key = `${prefix}/${sha256(data)[:24]}${ext}`  (prefix is optional)
//   short-circuit via headObject(key)
//   isOwnUrl tests custom_domain OR `${bucket}.${endpoint}`
//
// We use ali-oss in its browser build, which bundles its own SHA / xml2js and
// avoids Node 'fs'/'stream' dependencies. esbuild --platform=browser will pick
// up the package's `browser` field automatically.

// ali-oss has no first-party types we want to lean on; declare narrowly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OSSClient = any;

import { sha256Hex24 } from "../util/hash";

export interface UploaderConfig {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  bucket: string;
  prefix: string;       // may be empty; never starts/ends with "/"
  customDomain: string; // may be empty
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff", ".tiff": "image/tiff",
  ".ico": "image/x-icon",
};

function hostFromEndpoint(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, "");
}

export class Uploader {
  private client: OSSClient | null = null;

  constructor(public readonly config: UploaderConfig) {}

  private async ensureClient(): Promise<OSSClient> {
    if (this.client) return this.client;
    // Dynamic import keeps the ali-oss module out of the cold-load path for
    // users who never trigger an upload.
    const mod = await import("ali-oss");
    const OSS = (mod as { default?: unknown }).default ?? mod;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client = new (OSS as any)({
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      endpoint: this.config.endpoint,
      bucket: this.config.bucket,
      secure: true,
    });
    return this.client!;
  }

  private buildKey(hash: string, ext: string): string {
    const e = ext.startsWith(".") ? ext.toLowerCase() : "." + ext.toLowerCase();
    const filename = `${hash}${e}`;
    return this.config.prefix ? `${this.config.prefix}/${filename}` : filename;
  }

  buildUrl(key: string): string {
    if (this.config.customDomain) {
      let d = this.config.customDomain;
      if (!/^https?:\/\//.test(d)) d = "https://" + d;
      return `${d}/${key}`;
    }
    const host = hostFromEndpoint(this.config.endpoint);
    return `https://${this.config.bucket}.${host}/${key}`;
  }

  isOwnUrl(url: string): boolean {
    if (!url) return false;
    if (this.config.customDomain && url.includes(this.config.customDomain)) return true;
    const host = hostFromEndpoint(this.config.endpoint);
    return url.includes(`${this.config.bucket}.`) && url.includes(host);
  }

  /** Upload bytes; returns the public URL. Idempotent — headObject short-circuits. */
  async upload(bytes: Uint8Array, ext: string): Promise<string> {
    const hash = await sha256Hex24(bytes);
    const key = this.buildKey(hash, ext);
    const client = await this.ensureClient();

    // Short-circuit if the object already exists.
    let exists = false;
    try {
      await client.head(key);
      exists = true;
    } catch (e: unknown) {
      const status = (e as { status?: number; code?: string })?.status;
      const code = (e as { code?: string })?.code;
      if (status !== 404 && code !== "NoSuchKey") {
        // Propagate auth / network / CORS errors so the UI can show them.
        throw e;
      }
    }

    if (!exists) {
      const normalised = ext.startsWith(".") ? ext.toLowerCase() : "." + ext.toLowerCase();
      const headers: Record<string, string> = {};
      const mime = MIME[normalised];
      if (mime) headers["Content-Type"] = mime;
      // ali-oss browser build accepts Blob / Buffer / File. Use Blob — it's
      // built from a plain Uint8Array view, no Node Buffer required.
      const blob = new Blob([bytes as BlobPart], { type: headers["Content-Type"] || "application/octet-stream" });
      await client.put(key, blob, { headers });
    }

    return this.buildUrl(key);
  }

  /** Probe: PUT then HEAD then DELETE a 1-byte object to validate creds + CORS. */
  async probe(): Promise<void> {
    const client = await this.ensureClient();
    const key = (this.config.prefix ? this.config.prefix + "/" : "") + ".notepic-oss-probe";
    const blob = new Blob([new Uint8Array([0x4f]) as BlobPart], { type: "text/plain" });
    await client.put(key, blob, { headers: { "Content-Type": "text/plain" } });
    await client.head(key);
    await client.delete(key);
  }
}
