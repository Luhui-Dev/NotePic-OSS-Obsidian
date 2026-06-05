declare module "ali-oss" {
  export interface OSSOptions {
    accessKeyId: string;
    accessKeySecret: string;
    endpoint: string;
    bucket: string;
    secure?: boolean;
  }

  export interface PutOptions {
    headers?: Record<string, string>;
  }

  export default class OSS {
    constructor(options: OSSOptions);
    head(name: string): Promise<unknown>;
    put(name: string, file: Blob, options?: PutOptions): Promise<unknown>;
    delete(name: string): Promise<unknown>;
  }
}

declare module "upng-js" {
  const UPNG: {
    encode(
      buffers: Array<ArrayBufferLike>,
      width: number,
      height: number,
      colors: number,
    ): ArrayBuffer;
  };
  export default UPNG;
}
