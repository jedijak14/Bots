/** Serialize work against a shared inference engine. Waiting jobs can be cancelled. */
export function createLocalQueue() {
  let tail: Promise<void> = Promise.resolve();
  return async function run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    const previous = tail;
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    tail = previous.then(() => turn);
    let stop: (() => void) | undefined;
    try {
      await Promise.race([
        previous,
        new Promise<never>((_, reject) => {
          stop = () => reject(new DOMException("Stopped", "AbortError"));
          signal.addEventListener("abort", stop, { once: true });
          if (signal.aborted) stop();
        }),
      ]);
      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      return await work();
    } finally {
      if (stop) signal.removeEventListener("abort", stop);
      release();
    }
  };
}
