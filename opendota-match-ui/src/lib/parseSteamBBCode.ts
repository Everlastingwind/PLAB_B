/**
 * 将 Steam 公告常见的 BBCode 转为 HTML（用于 Dota 补丁说明）。
 * 仅生成静态标签，不包含脚本；展示时建议仍配合受信来源使用。
 */

function escapeHtml(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeHttpUrl(raw: string): string {
  const u = raw.trim();
  if (/^https?:\/\//i.test(u)) return u;
  return "";
}

function applyInlineBbcodeAfterEscape(escaped: string): string {
  let x = escaped;
  x = x.replace(/\[b\]/gi, "<strong>").replace(/\[\/b\]/gi, "</strong>");
  x = x.replace(/\[i\]/gi, "<em>").replace(/\[\/i\]/gi, "</em>");
  x = x.replace(/\[u\]/gi, "<u>").replace(/\[\/u\]/gi, "</u>");
  x = x.replace(/\[strike\]/gi, "<s>").replace(/\[\/strike\]/gi, "</s>");
  return x;
}

/**
 * BBCode → HTML。支持 Steam 补丁中常见的 [b]、[list]、[url]、[h1]、[code] 等。
 */
export function parseSteamBBCode(text: string): string {
  if (!text) return "";
  let s = String(text).replace(/\r\n/g, "\n");

  const chunks: string[] = [];

  const pushChunk = (html: string) => {
    chunks.push(html);
    return `«§${chunks.length - 1}»`;
  };

  // [code]：先抽出，避免内部被二次解析
  s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, code) =>
    pushChunk(
      `<pre class="mb-3 overflow-x-auto rounded border border-skin-line bg-skin-inset p-3 text-xs leading-relaxed text-skin-ink">${escapeHtml(code)}</pre>`
    )
  );

  // [url=…]…[/url]（标签内原文稍后整体 escape，再还原链接）
  s = s.replace(
    /\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi,
    (_, urlRaw: string, label: string) => {
      const href = sanitizeHttpUrl(urlRaw);
      if (!href) {
        return pushChunk(`<span>${escapeHtml(label)}</span>`);
      }
      const innerEscaped = escapeHtml(label);
      const inner = applyInlineBbcodeAfterEscape(innerEscaped);
      return pushChunk(
        `<a href="${href}" class="text-accent-cyan underline underline-offset-2 hover:no-underline" target="_blank" rel="noopener noreferrer">${inner}</a>`
      );
    }
  );

  // [url]…[/url]
  s = s.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_, url: string) => {
    const href = sanitizeHttpUrl(url.trim());
    if (!href) return pushChunk(`<span>${escapeHtml(url)}</span>`);
    const esc = escapeHtml(url.trim());
    return pushChunk(
      `<a href="${href}" class="text-accent-cyan underline underline-offset-2 hover:no-underline" target="_blank" rel="noopener noreferrer">${esc}</a>`
    );
  });

  // 标题块（内层再走一轮 inline）
  s = s.replace(
    /\[h1\]([\s\S]*?)\[\/h1\]/gi,
    (_, inner: string) =>
      pushChunk(
        `<h2 class="mt-5 mb-2 border-b border-skin-line pb-1 text-xl font-bold text-skin-ink">${applyInlineBbcodeAfterEscape(escapeHtml(inner))}</h2>`
      )
  );
  s = s.replace(
    /\[h2\]([\s\S]*?)\[\/h2\]/gi,
    (_, inner: string) =>
      pushChunk(
        `<h3 class="mt-4 mb-2 text-lg font-semibold text-skin-ink">${applyInlineBbcodeAfterEscape(escapeHtml(inner))}</h3>`
      )
  );
  s = s.replace(
    /\[h3\]([\s\S]*?)\[\/h3\]/gi,
    (_, inner: string) =>
      pushChunk(
        `<h4 class="mt-3 mb-1.5 text-base font-semibold text-skin-ink">${applyInlineBbcodeAfterEscape(escapeHtml(inner))}</h4>`
      )
  );

  // 剩余文本统一 escape
  s = escapeHtml(s);

  // Steam 列表：[list][*]…[*]…[/list]（先处理 [list][*] 连体，再处理孤立标签）
  s = s.replace(/\[list\]\s*\[\*\]/gi, "<ul><li>");
  s = s.replace(/\[list\]/gi, "<ul>");
  s = s.replace(/\[\*\]/g, "</li><li>");
  s = s.replace(/\[\/list\]/gi, "</li></ul>");

  s = applyInlineBbcodeAfterEscape(s);

  // 占位符不含换行：先转义换行再还原块，避免破坏 &lt;pre&gt; 内真实换行
  s = s.replace(/\n/g, "<br />");

  s = s.replace(/«§(\d+)»/g, (_, i) => chunks[Number(i)] ?? "");

  return `<div class="steam-bbcode-root text-sm leading-relaxed text-skin-ink [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:marker:text-skin-sub">${s}</div>`;
}
