import { useEffect, useState } from "react";

/**
 * 延迟更新值，用于减轻高频输入下的昂贵计算（如大列表过滤）。
 * @param value 即时值（如受控输入）
 * @param delayMs 防抖毫秒数，建议 300–500
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
