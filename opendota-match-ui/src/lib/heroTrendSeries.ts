/**
 * Meta 胜率趋势：将上一版本末期累计胜率收盘点拼到当前版本时间序列之前。
 * 对应「先拉 7.41C 全序序列 + 再取 7.41B 末条」的缝合语义（数据来源于聚合后的序列端点）。
 */
export type HeroTrendStitchResult = {
  rates: number[];
  /** 与 rates 等长；首点可为 true（上一版本封盘） */
  isBaseline: boolean[];
};

export function stitchHeroTrendCumulativeSeries(
  latestPatchSeriesAsc: readonly number[],
  previousPatchSeriesAsc: readonly number[]
): HeroTrendStitchResult {
  const baseline =
    previousPatchSeriesAsc.length > 0
      ? previousPatchSeriesAsc[previousPatchSeriesAsc.length - 1]
      : null;

  if (baseline != null && latestPatchSeriesAsc.length > 0) {
    return {
      rates: [baseline, ...latestPatchSeriesAsc],
      isBaseline: [true, ...latestPatchSeriesAsc.map(() => false)],
    };
  }
  if (baseline != null && latestPatchSeriesAsc.length === 0) {
    return {
      rates: [baseline],
      isBaseline: [true],
    };
  }
  return {
    rates: [...latestPatchSeriesAsc],
    isBaseline: latestPatchSeriesAsc.map(() => false),
  };
}

/** Tooltip 文案：上一版本封盘锚点 */
export function heroTrendBaselineTooltipTitle(previousPatch: string): string {
  return `${previousPatch} 封盘数据`;
}

/**
 * 趋势曲线缝合入口（与 Meta 表 `buildTopHeroOverall` 使用同一逻辑）。
 * 入参为已在内存中求得的累计胜率时间序列（当前补丁升序、上一补丁升序）。
 */
export function fetchHeroTrendData(
  latestPatchSeriesAsc: readonly number[],
  previousPatchSeriesAsc: readonly number[]
): HeroTrendStitchResult {
  return stitchHeroTrendCumulativeSeries(
    latestPatchSeriesAsc,
    previousPatchSeriesAsc
  );
}
