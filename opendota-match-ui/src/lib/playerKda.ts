import { numOrZero } from "./display";

/**
 * 从任意玩家行对象解析 K/D/A，兼容 OpenDota / 解析器短字段与大小写变体，
 * 避免 slim JSON 字段名不一致时 UI 整列显示为 0。
 */
export function kdaFromPlayerRecord(row: Record<string, unknown>): {
  kills: number;
  deaths: number;
  assists: number;
} {
  return {
    kills: numOrZero(
      row["kills"] ?? row["Kills"] ?? row["k"] ?? row["K"]
    ),
    deaths: numOrZero(
      row["deaths"] ?? row["Deaths"] ?? row["d"] ?? row["D"]
    ),
    assists: numOrZero(
      row["assists"] ?? row["Assists"] ?? row["a"] ?? row["A"]
    ),
  };
}

/** 列表聚合（表头高亮最大击杀等）用，避免 undefined 比较异常 */
export function safeKills(p: { kills?: number }): number {
  const n = p.kills;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}
