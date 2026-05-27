import { debounce, throttle } from '../utils/debounce';

let snapshotInFlight: Promise<unknown> | null = null;

/** Один активный /sync на экран — не копим параллельные запросы. */
export function runExclusiveSnapshot<T>(runner: () => Promise<T>): Promise<T> {
  if (snapshotInFlight) return snapshotInFlight as Promise<T>;
  const task = runner().finally(() => {
    if (snapshotInFlight === task) snapshotInFlight = null;
  });
  snapshotInFlight = task;
  return task;
}

/** Realtime: не дергаем полный sync чаще раза в ~1.2 с. */
export function createRealtimeSyncScheduler(onSync: () => void) {
  const debounced = debounce(onSync, 1200);
  const throttled = throttle(onSync, 4000);
  return {
    push: () => {
      debounced();
      throttled();
    },
    cancel: () => debounced.cancel(),
  };
}
