import { useEffect, useState } from "react";
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
        const res = await fetch("/data/entity_maps.json", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as EntityMapsPayload;
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
