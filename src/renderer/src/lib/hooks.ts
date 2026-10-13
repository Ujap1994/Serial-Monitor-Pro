import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Ref that always holds the latest value. Timers and data listeners read it
 * instead of capturing a stale value from an earlier render.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
