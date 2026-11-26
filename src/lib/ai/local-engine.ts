/** Share one model load across turns while allowing each waiter to stop. */
export function createLocalEngineManager<T>(load: (progress: (message: string) => void) => Promise<T>) {
  let pending: Promise<T> | undefined;
  const listeners = new Set<(message: string) => void>();
  const aborted = () => new DOMException("Stopped", "AbortError");
  return {
    async get(signal: AbortSignal, onProgress: (message: string) => void): Promise<T> {
      if (signal.aborted) throw aborted();
      listeners.add(onProgress);
      if (!pending) {
        pending = Promise.resolve().then(() => load(message => {
          for (const listener of listeners) listener(message);
        })).catch(error => { pending = undefined; throw error; });
      }
      let stop: (() => void) | undefined;
      try {
        // WebLLM cannot cancel an initial model download; stop waiting promptly,
        // remove progress listeners, and keep the shared load for a later turn.
        const cancellation = new Promise<never>((_, reject) => {
          stop = () => reject(aborted());
          signal.addEventListener("abort", stop, { once: true });
          if (signal.aborted) stop();
        });
        return await Promise.race([pending, cancellation]);
      } finally {
        listeners.delete(onProgress);
        if (stop) signal.removeEventListener("abort", stop);
      }
    },
  };
}
