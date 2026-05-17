import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";

export type SEOProps = {
  title: string;
  description?: string;
  keywords?: string;
  /**
   * 为 true 时，直接使用 `title` 作为完整 <title>（例如「某选手 - 近期天梯战绩 - PlanB」）；
   * 为 false 时，自动拼为 `title | DOTA2 Plan B`（适合首页等站内向页面）。
   */
  fullTitle?: boolean;
  /** 覆盖自动 canonical；可传路径（/match/123）或完整 URL */
  canonical?: string;
};

/** 全站默认 SEO / 社交分享描述（中英双语）；与 index.html 中 meta description 保持一致 */
export const SITE_DEFAULT_DESCRIPTION =
  "职业选手都在用的数据网站, Pro players' choice for match data.";

/** 搜索引擎认可的权威域名（与 index.html 静态 canonical 一致） */
export const SITE_CANONICAL_ORIGIN = "https://www.dota2planb.com";

const DEFAULT_TITLE_SUFFIX = "DOTA2 Plan B";

function buildDocumentTitle(title: string, fullTitle: boolean) {
  if (fullTitle) return title;
  return `${title} | ${DEFAULT_TITLE_SUFFIX}`;
}

/** 根据 pathname 生成权威链接，首页固定带尾斜杠 */
export function buildCanonicalUrl(pathname: string): string {
  const path = pathname.split("?")[0].split("#")[0] || "/";
  if (path === "/") return `${SITE_CANONICAL_ORIGIN}/`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_CANONICAL_ORIGIN}${normalized}`;
}

function resolveCanonicalHref(pathname: string, override?: string): string {
  if (!override) return buildCanonicalUrl(pathname);
  if (/^https?:\/\//i.test(override)) return override;
  return buildCanonicalUrl(override);
}

export function SEO({
  title,
  description = SITE_DEFAULT_DESCRIPTION,
  keywords,
  fullTitle = false,
  canonical,
}: SEOProps) {
  const { pathname } = useLocation();
  const documentTitle = buildDocumentTitle(title, fullTitle);
  const canonicalHref = resolveCanonicalHref(pathname, canonical);

  const isCustomDescription = description !== SITE_DEFAULT_DESCRIPTION;

  return (
    <Helmet>
      <title>{documentTitle}</title>
      <link rel="canonical" href={canonicalHref} />
      {isCustomDescription ? (
        <meta name="description" content={description} />
      ) : null}
      <meta property="og:title" content={documentTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={canonicalHref} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={documentTitle} />
      <meta name="twitter:description" content={description} />
      {keywords ? <meta name="keywords" content={keywords} /> : null}
    </Helmet>
  );
}
