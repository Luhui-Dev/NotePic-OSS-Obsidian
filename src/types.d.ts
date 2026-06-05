// Minimal ambient declarations for npm packages we only use through a thin wrapper.
// Keeping these as `any` is intentional — neither library ships first-party types
// we want to take a dependency on, and the wrappers (`uploader.ts`, `compressor.ts`)
// constrain the surface we actually call.

declare module "ali-oss" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OSS: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export default OSS;
}

declare module "upng-js" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const UPNG: any;
  export default UPNG;
}
