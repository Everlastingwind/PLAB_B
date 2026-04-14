import { useEffect, useState } from "react";
import { loadEntityMapsPayload } from "../lib/entityMapsLoader";
import type { EntityMapsPayload } from "../types/entityMaps";

export function useEntityMaps(): {
  maps: EntityMapsPayload | null;
  loading: boolean;
  error: string | null;
} {
  const [maps, setMaps] = useState<EntityMapsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const j = await loadEntityMapsPayload();
        if (!cancelled) setMaps(j);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { maps, loading, error };
}
