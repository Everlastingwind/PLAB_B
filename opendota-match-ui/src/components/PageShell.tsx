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
      <div className="flex w-full max-w-3xl items-center justify-center gap-2 sm:gap-3">
        <div className="min-w-0 w-full">
          <HeroSearch
            maps={maps}
            feedMode={feedMode}
            onFeedModeChange={onFeedModeChange}
          />
        </div>
      </div>
    ) : centerSearch && loading ? (
      <div className="mx-auto h-10 w-full max-w-3xl animate-pulse rounded-md bg-skin-inset" />
    ) : undefined;

  return (
    <div className="min-h-screen bg-skin-page text-skin-ink antialiased transition-colors">
      <AppHeader center={center} trailing={trailing} />
      {children}
    </div>
  );
}
