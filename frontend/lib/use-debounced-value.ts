"use client";

import { useEffect, useState } from "react";

/**
 * Returns a value after it has stopped changing for `delayMs`. Used to keep
 * text filters from issuing a request on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
