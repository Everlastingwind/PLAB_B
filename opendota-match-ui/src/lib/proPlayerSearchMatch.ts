/**
 * 全局搜索栏「职业选手」匹配：仅按展示名 / 额外别名检索，不按 Steam account_id 数字模糊匹配。
 * 使用普通字符串包含（非正则），括号、空格等字符按字面量参与匹配。
 */

export type ProPlayerSearchCandidate = {
  accountId: number;
  /** 下拉展示主文案（注册名或 overrides 覆盖名，可含 Ame(smurf) 等） */
  proName: string;
  /** 可选：种子 displayName、扩展别名等，参与检索但不替代主展示名 */
  extraSearchLabels?: readonly string[];
};

export function collectProPlayerSearchStrings(
  c: ProPlayerSearchCandidate
): string[] {
  const out = new Set<string>();
  const main = String(c.proName ?? "").trim();
  if (main) out.add(main);
  for (const x of c.extraSearchLabels ?? []) {
    const t = String(x).trim();
    if (t) out.add(t);
  }
  return [...out];
}

/** 是否命中任一展示名/别名（忽略大小写） */
export function proPlayerMatchesSearchQuery(
  c: ProPlayerSearchCandidate,
  rawQuery: string
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return false;
  return collectProPlayerSearchStrings(c).some((lab) =>
    lab.toLowerCase().includes(q)
  );
}

/** 将 `pro_account_display_overrides` 合并进候选：保证仅存在于 overrides 的职业账号也可搜到 */
export function mergeProDisplayOverridesIntoSearchCandidates(
  candidates: readonly ProPlayerSearchCandidate[],
  overrides: ReadonlyMap<number, string>
): ProPlayerSearchCandidate[] {
  if (!overrides.size) return [...candidates];
  const m = new Map<number, ProPlayerSearchCandidate>();
  for (const c of candidates) {
    m.set(c.accountId, { ...c });
  }
  for (const [aid, label] of overrides.entries()) {
    const t = String(label ?? "").trim();
    if (!t) continue;
    m.set(aid, { accountId: aid, proName: t });
  }
  return [...m.values()];
}
