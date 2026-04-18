import { Helmet } from "react-helmet-async";

type SEOMetaProps = {
  title: string;
  description?: string;
  keywords?: string;
};

/** 全站默认 SEO / 社交分享描述（中英双语） */
export const SITE_DEFAULT_DESCRIPTION =
  "专业的 Dota 2 职业比赛数据分析平台，提供高分段对局解析、最新版本英雄出装胜率、天赋加点等大数据服务。The premier Dota 2 professional match data platform. We offer high-bracket game breakdowns, latest patch hero build win rates, talent guides, and comprehensive esports data analytics.";

export function SEOMeta({
  title,
  description = SITE_DEFAULT_DESCRIPTION,
  keywords,
}: SEOMetaProps) {
  const fullTitle = `${title} | DOTA2 Plan B`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      {keywords ? <meta name="keywords" content={keywords} /> : null}
    </Helmet>
  );
}
