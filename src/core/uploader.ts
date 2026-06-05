// Aliyun OSS uploader. Mirrors notepic_oss/uploader.py:
//   key = `${prefix}/${sha256(data)[:24]}${ext}`  (prefix is optional)
//   short-circuit via headObject(key)
//   isOwnUrl tests custom_domain OR `${bucket}.${endpoint}`

import { requestUrl } from "obsidian";
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
  return endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export class Uploader {
  constructor(public readonly config: UploaderConfig) {}

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

  private requestUrlForKey(key: string): string {
    const host = hostFromEndpoint(this.config.endpoint);
    return `https://${this.config.bucket}.${host}/${encodeObjectKey(key)}`;
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

    // Short-circuit if the object already exists.
    let exists = false;
    try {
      await this.request("HEAD", key);
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
      await this.request("PUT", key, headers, toArrayBuffer(bytes));
    }

    return this.buildUrl(key);
  }

  /** Probe: PUT then HEAD then DELETE a 1-byte object to validate creds + CORS. */
  async probe(): Promise<void> {
    const key = (this.config.prefix ? this.config.prefix + "/" : "") + ".notepic-oss-probe";
    const headers = { "Content-Type": "text/plain" };
    await this.request("PUT", key, headers, new Uint8Array([0x4f]).buffer);
    await this.request("HEAD", key);
    await this.request("DELETE", key);
  }

  private async request(
    method: "HEAD" | "PUT" | "DELETE",
    key: string,
    headers: Record<string, string> = {},
    body?: ArrayBuffer,
  ): Promise<void> {
    const date = new Date().toUTCString();
    const signedHeaders: Record<string, string> = { ...headers, Date: date };
    signedHeaders.Authorization = await this.authorization(method, key, signedHeaders);
    const response = await requestUrl({
      url: this.requestUrlForKey(key),
      method,
      headers: signedHeaders,
      body,
      throw: false,
    });

    if (response.status >= 200 && response.status < 300) return;
    throw ossError(response.status, response.text);
  }

  private async authorization(
    method: "HEAD" | "PUT" | "DELETE",
    key: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const contentType = headers["Content-Type"] ?? "";
    const canonicalResource = `/${this.config.bucket}/${key}`;
    const stringToSign = [
      method,
      "",
      contentType,
      headers.Date,
      canonicalResource,
    ].join("\n");
    const signature = await hmacSha1Base64(this.config.accessKeySecret, stringToSign);
    return `OSS ${this.config.accessKeyId}:${signature}`;
  }
}

function encodeObjectKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64(new Uint8Array(signature));
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function ossError(status: number, body: string): Error & { status?: number; code?: string } {
  const code = extractXmlTag(body, "Code");
  const message = extractXmlTag(body, "Message") || `OSS request failed with HTTP ${status}`;
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  if (code) error.code = code;
  return error;
}

function extractXmlTag(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match?.[1] ?? "";
}
