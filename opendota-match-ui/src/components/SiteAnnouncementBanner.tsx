import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

const STORAGE_KEY = "plab-site-announce-dismiss-v1";

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function SiteAnnouncementBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div
      role="region"
      aria-label="站内公告"
      className={cn(
        "relative z-[60] border-b border-amber-500/40 bg-amber-500/[0.09] px-4 py-2.5 text-center text-sm leading-relaxed text-skin-ink",
        "dark:border-amber-400/35 dark:bg-amber-400/[0.08]"
      )}
    >
      <p className="mx-auto max-w-4xl px-2 pr-10 sm:pr-12">
        暂停网站新功能开发，如果数据对你有帮助请反馈告诉我，我正在考虑是否需要继续购买服务器存储空间来上传及保存数据，感谢大家。
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-skin-sub hover:bg-black/10 hover:text-skin-ink dark:hover:bg-white/10"
        aria-label="关闭公告"
      >
        <X className="h-4 w-4 shrink-0" strokeWidth={2} />
      </button>
    </div>
  );
}
