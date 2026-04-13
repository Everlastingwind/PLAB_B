import { Copy } from "lucide-react";
import type { MatchHeaderData } from "../data/mockMatch";

interface MatchHeaderProps {
  data: MatchHeaderData;
  onCopyMatchId?: () => void;
}

export function MatchHeader({ data, onCopyMatchId }: MatchHeaderProps) {
  return (
    <header className="border-b border-skin-line bg-skin-frame dark:bg-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-2.5 sm:px-6 lg:px-10">
        <div className="flex justify-end">
          <div className="flex items-center gap-2">
            <span className="text-xs text-skin-sub">比赛编号</span>
            <span className="font-mono text-sm text-skin-ink">{data.matchId}</span>
            <button
              type="button"
              onClick={onCopyMatchId}
              className="rounded p-1 text-skin-sub transition hover:bg-skin-inset hover:text-amber-600 dark:hover:bg-slate-800 dark:hover:text-amber-500"
              title="复制比赛编号"
              aria-label="复制比赛编号"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
