/**
 * Meta 胜率趋势：全库历史样本的累计胜率时间序列（不做跨版本缝合）。
 */
export type HeroTrendStitchResult = {
  rates: number[];
  /** 与 rates 等长；保留字段以兼容 UI，恒为 false */
  isBaseline: boolean[];
};

export function stitchHeroTrendCumulativeSeries(
  seriesAsc: readonly number[]
): HeroTrendStitchResult {
  return {
    rates: [...seriesAsc],
    isBaseline: seriesAsc.map(() => false),
  };
}

/** @deprecated 全库聚合后不再使用封盘基线 Tooltip */
export function heroTrendBaselineTooltipTitle(_previousPatch: string): string {
  return "历史累计胜率";
}

/** 趋势曲线入口（与 Meta 表 `buildTopHeroOverall` 使用同一逻辑） */
export function fetchHeroTrendData(
  seriesAsc: readonly number[]
): HeroTrendStitchResult {
  return stitchHeroTrendCumulativeSeries(seriesAsc);
}
