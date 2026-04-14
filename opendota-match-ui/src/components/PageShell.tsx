import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { HeroSearch } from "./HeroSearch";
import type { FeedMode } from "./FeedModeToggle";
import { useEntityMaps } from "../hooks/useEntityMaps";

export function PageShell({
  centerSearch,
  feedMode,
  onFeedModeChange,
  trailing,
  children,
}: {
  /** 主页 / 英雄 / 选手页：中间为英雄搜索 */
  centerSearch?: boolean;
  /** 仅主页：PUB=本地上传解析录像，PRO=OpenDota 职业索引 */
  feedMode?: FeedMode;
  onFeedModeChange?: (m: FeedMode) => void;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const { maps, loading } = useEntityMaps();
  const center =
    centerSearch && maps ? (
      <div className="flex w-full min-w-0 flex-1 basis-0 flex-row items-stretch justify-start gap-2 max-w-full sm:mx-auto sm:max-w-3xl sm:justify-center sm:gap-3">
        <div className="flex w-full min-w-0 max-w-full flex-1 flex-col">
          <HeroSearch
            maps={maps}
            feedMode={feedMode}
            onFeedModeChange={onFeedModeChange}
          />
        </div>
      </div>
    ) : centerSearch && loading ? (
      <div className="h-10 w-full max-w-full animate-pulse rounded-md bg-skin-inset sm:mx-auto sm:max-w-3xl" />
    ) : undefined;

  return (
    <div className="min-h-screen bg-skin-page text-skin-ink antialiased transition-colors">
      <AppHeader center={center} trailing={trailing} />
      <div className="relative z-0 min-w-0">{children}</div>
    </div>
  );
}
