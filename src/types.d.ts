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
