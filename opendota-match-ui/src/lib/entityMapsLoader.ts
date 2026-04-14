import type { EntityMapsPayload } from "../types/entityMaps";
import { fetchStaticJson } from "./fetchStaticJson";

let entityMapsPromise: Promise<EntityMapsPayload> | null = null;

/** 全站单例，避免 Header 与比赛页各拉一遍大 JSON。 */
export function loadEntityMapsPayload(): Promise<EntityMapsPayload> {
  if (!entityMapsPromise) {
    entityMapsPromise = fetchStaticJson<EntityMapsPayload>(
      "/data/entity_maps.json",
      { cache: "default" }
    ).catch((e) => {
      entityMapsPromise = null;
      throw e;
    });
  }
  return entityMapsPromise;
}
