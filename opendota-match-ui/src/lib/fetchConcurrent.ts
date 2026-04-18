/**
 * 对列表逐项执行异步任务，最多 `concurrency` 个并发，避免串行 `await` 拉长总耗时。
 */
export async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const n = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  let index = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const i = index++;
        if (i >= items.length) return;
        await fn(items[i]!);
      }
    })
  );
}
