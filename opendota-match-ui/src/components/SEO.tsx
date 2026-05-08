import { Helmet } from "react-helmet-async";

export type SEOProps = {
  title: string;
  description?: string;
  keywords?: string;
  /**
   * 为 true 时，直接使用 `title` 作为完整 <title>（例如「某选手 - 近期天梯战绩 - PlanB」）；
   * 为 false 时，自动拼为 `title | DOTA2 Plan B`（适合首页等站内向页面）。
   */
  fullTitle?: boolean;
};

/** 全站默认 SEO / 社交分享描述（中英双语）；与 index.html 中 meta description 保持一致 */
export const SITE_DEFAULT_DESCRIPTION =
  "职业选手都在用的数据网站, Pro players' choice for match data.";

const DEFAULT_TITLE_SUFFIX = "DOTA2 Plan B";

function buildDocumentTitle(title: string, fullTitle: boolean) {
  if (fullTitle) return title;
  return `${title} | ${DEFAULT_TITLE_SUFFIX}`;
}

export function SEO({
  title,
  description = SITE_DEFAULT_DESCRIPTION,
  keywords,
  fullTitle = false,
}: SEOProps) {
  const documentTitle = buildDocumentTitle(title, fullTitle);

  const isCustomDescription = description !== SITE_DEFAULT_DESCRIPTION;

  return (
    <Helmet>
      <title>{documentTitle}</title>
      {isCustomDescription ? (
        <meta name="description" content={description} />
      ) : null}
      <meta property="og:title" content={documentTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={documentTitle} />
      <meta name="twitter:description" content={description} />
      {keywords ? <meta name="keywords" content={keywords} /> : null}
    </Helmet>
  );
}
