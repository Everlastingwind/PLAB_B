/** 与 DEM / OpenDota 解析字段对齐：空值显示为「-」 */

export function dashStr(v: unknown): string {
  if (v === null || v === undefined) return "-";
  const s = String(v).trim();
  return s === "" ? "-" : s;
}

export function dashNum(v: unknown): string {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (Number.isNaN(n)) return "-";
  return n.toLocaleString("zh-CN");
}

export function numOrZero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function formatDurationSeconds(sec: unknown): string {
  const s = numOrZero(sec);
  if (s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** 表格数字：缺省为「-」；NET 等用 gold 千分位 */
export function formatStat(
  v: unknown,
  _mode: "int" | "gold" = "int"
): string {
  if (v === undefined || v === null) return "-";
  const n = Number(v);
  if (Number.isNaN(n)) return "-";
  return n.toLocaleString("zh-CN");
}

/** 选手名、战队等展示用：去掉替换符、控制符、零宽字符，合并多余空白 */
export function sanitizePlayerDisplayText(s: string): string {
  if (!s) return "";
  return s
    .replace(/\uFFFD/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Valve 资源字符串中的 {s:token}；无服务端展开时去掉占位，并清理常见残片 */
export function formatValveTalentText(s: string): string {
  let t = s.trim();
  if (t.includes("{s:")) {
    t = t.replace(/\{s:[^}]+\}/g, "");
  }
  t = t.replace(/(?:^|\s)\+\s*%\s*/g, " ");
  t = t.replace(/(?:^|[\s(])-\s*s\s+/g, " ");
  t = t.replace(/(?:^|\s)\+\s*s\s+/g, " ");
  t = t.replace(/(?<=[a-zA-Z])\s+%\s+(?=[A-Z])/g, " ");
  return t.replace(/\s+/g, " ").trim();
}
