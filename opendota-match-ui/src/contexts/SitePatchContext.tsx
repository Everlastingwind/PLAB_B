import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { AppBootSplash } from "../components/AppBootSplash";
import {
  ensureSitePatchLoaded,
  invalidateSitePatchCache,
  type SitePatchConfig,
} from "../lib/sitePatchStore";

type SitePatchContextValue = {
  patch: SitePatchConfig | null;
  loading: boolean;
  error: string | null;
  /** PatchUpdatePanel 更新 site_settings 后调用，全站重新拉取 */
  refresh: () => Promise<void>;
};

const SitePatchContext = createContext<SitePatchContextValue | null>(null);

export function SitePatchProvider({ children }: { children: ReactNode }) {
  const [patch, setPatch] = useState<SitePatchConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await ensureSitePatchLoaded();
      setPatch(p);
    } catch (e) {
      setPatch(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    invalidateSitePatchCache();
    await load();
  }, [load]);

  const value = useMemo(
    () => ({ patch, loading, error, refresh }),
    [patch, loading, error, refresh]
  );

  return (
    <SitePatchContext.Provider value={value}>
      {children}
    </SitePatchContext.Provider>
  );
}

export function useSitePatch(): SitePatchContextValue {
  const v = useContext(SitePatchContext);
  if (!v) {
    throw new Error("useSitePatch 必须在 SitePatchProvider 内使用");
  }
  return v;
}

/** 阻塞路由直至 site_settings 就绪；错误时可重试 */
export function SitePatchReadyGate({ children }: { children: ReactNode }) {
  const { loading, error, patch, refresh } = useSitePatch();

  if (loading) {
    return <AppBootSplash />;
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="max-w-lg text-sm text-red-600 dark:text-red-400">{error}</p>
        <p className="max-w-lg text-xs text-skin-sub">
          请在 Supabase SQL Editor 执行仓库内{" "}
          <code className="rounded bg-skin-inset px-1 py-0.5">
            opendota-match-ui/supabase/site_settings.sql
          </code>{" "}
          后重试。
        </p>
        <button
          type="button"
          className="rounded border border-skin-line bg-skin-card px-4 py-2 text-sm font-medium text-skin-ink"
          onClick={() => void refresh()}
        >
          重试
        </button>
        <Link to="/" className="text-xs text-skin-sub underline">
          返回首页
        </Link>
      </div>
    );
  }

  if (!patch) {
    return (
      <div className="p-8 text-center text-sm text-skin-sub">
        补丁配置未就绪。
      </div>
    );
  }

  return <>{children}</>;
}
