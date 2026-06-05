// Minimal p-limit replacement: caps the number of concurrently-executing
// async tasks. Returns a wrapper that yields when the slot is free.

export type Limit = <T>(fn: () => Promise<T>) => Promise<T>;

export function pLimit(max: number): Limit {
  const queue: Array<() => void> = [];
  let active = 0;

  const next = () => {
    if (active >= max) return;
    const job = queue.shift();
    if (job) job();
  };

  return <T,>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(
          (v) => { active--; next(); resolve(v); },
          (e) => { active--; next(); reject(e); },
        );
      };
      if (active < max) run();
      else queue.push(run);
    });
  };
}
