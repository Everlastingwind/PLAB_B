/** 文档级滚动：兼容 scrollingElement / html / body / window */

export function homeScrollStorageKey(pathname: string, search: string) {
  return `home-scroll:${pathname}${search}`;
}

export function homeAnchorStorageKey(pathname: string, search: string) {
  return `home-anchor:${pathname}${search}`;
}

export function readDocumentScrollY(): number {
  const se = document.scrollingElement;
  const a = se && se instanceof HTMLElement ? se.scrollTop : 0;
  const b = document.documentElement.scrollTop;
  const c = document.body.scrollTop;
  const w = window.scrollY || 0;
  const y = Math.max(a, b, c, w);
  return Number.isFinite(y) ? y : 0;
}

export function scrollDocumentToY(y: number) {
  window.scrollTo({ top: y, left: 0, behavior: "auto" });
  const se = document.scrollingElement;
  if (se && se instanceof HTMLElement) se.scrollTop = y;
  document.documentElement.scrollTop = y;
  document.body.scrollTop = y;
}

/**
 * 进入比赛详情前写入：像素滚动 + 当前卡片 match_id（宽屏/最大化下列表可能几乎无纵向溢出，仅靠 scrollY 不可靠）。
 */
export function persistHomeListScrollBeforeNavigate(matchId: number) {
  const p = window.location.pathname;
  const s = window.location.search;
  sessionStorage.setItem(homeScrollStorageKey(p, s), String(readDocumentScrollY()));
  sessionStorage.setItem(homeAnchorStorageKey(p, s), String(matchId));
}
