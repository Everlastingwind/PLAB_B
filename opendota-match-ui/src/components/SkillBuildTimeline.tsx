import type { SkillBuildStepUi } from "../data/mockMatchPlayers";
import {
  abilityIconFallbackUrl,
  abilityIconUrl,
  dotaTalentsIconUrl,
  normalizeDotaAssetUrl,
  onDotaSteamAssetImgError,
  steamCdnImgDefer,
} from "../data/mockMatchPlayers";
import { cn } from "../lib/cn";

const RAISED =
  "rounded-md border border-gray-200 bg-white shadow-sm transition-colors duration-200 ease-in-out dark:border-slate-600 dark:bg-slate-700 dark:shadow-none";

/** 录像战斗日志里会出现的传送门/扫描等非「加点」技能，不应出现在加点顺序条 */
export function isNoiseAbilityStep(s: SkillBuildStepUi): boolean {
  const k = (s.abilityKey || "").toLowerCase();
  if (!k) return false;
  if (k.includes("twin_gate") || k.includes("portal_warp")) return true;
  if (k.includes("ability_lamp") || k === "plus_high_five") return true;
  if (k.startsWith("courier_") || k.includes("_courier_")) return true;
  if (k.includes("ward_dispenser") || k === "ability_capture") return true;
  return false;
}

function abilityImgSrc(s: SkillBuildStepUi): string {
  const u = normalizeDotaAssetUrl(s.img || "");
  if (u) return u;
  if (s.abilityKey) return abilityIconUrl(s.abilityKey);
  if (s.kind === "talent" || s.isTalent) return dotaTalentsIconUrl;
  if (s.kind === "unknown") return abilityIconFallbackUrl;
  return abilityIconFallbackUrl;
}

function stepTooltip(s: SkillBuildStepUi): string {
  return (
    (s.name || s.desc || s.labelCn || s.labelEn || "").trim() ||
    `Lv.${s.level ?? s.step}`
  );
}

/** 与列表渲染一致：用于在 slim 适配器里比较两套 skill_build 哪套更适合展示 */
export function countTimelineVisibleSteps(steps: SkillBuildStepUi[]): number {
  const list = steps.length >= 25 ? steps.slice(0, 25) : steps;
  let n = 0;
  for (const s of list) {
    if (s.kind === "empty") continue;
    if (s.kind === "unknown") continue;
    if (isNoiseAbilityStep(s)) continue;
    n++;
  }
  return n;
}

export function SkillBuildTimeline({ steps }: { steps: SkillBuildStepUi[] }) {
  const list = steps.length >= 25 ? steps.slice(0, 25) : steps;
  // 隐藏 empty/unknown，避免出现白块占位图标。
  const visible = list.filter((s) => {
    if (s.kind === "empty") return false;
    if (s.kind === "unknown") return false;
    if (isNoiseAbilityStep(s)) return false;
    return true;
  });
  if (!visible.length) return null;
  return (
    <div className="max-w-full pt-0.5">
      <div className="flex min-h-[18px] w-full flex-wrap gap-1">
        {visible.map((s) => {
          const tip = stepTooltip(s);
          const src = abilityImgSrc(s);
          const isTalentStep = s.kind === "talent" || s.isTalent;

          return (
            <div key={s.step} className="group relative">
              {isTalentStep ? (
                <div
                  className={cn(
                    "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[2px] text-[10px] font-semibold text-amber-950",
                    "border border-amber-300 bg-amber-200 dark:border-amber-500/70 dark:bg-amber-400",
                    "shadow-sm transition-colors duration-200 ease-in-out dark:shadow-none"
                  )}
                  title={tip}
                >
                  T
                </div>
              ) : (
                <div
                  className={cn(
                    "h-[18px] w-[18px] shrink-0 overflow-hidden rounded-[2px]",
                    RAISED
                  )}
                >
                  <img
                    src={src}
                    alt=""
                    className="h-full w-full object-cover"
                    {...steamCdnImgDefer}
                    title={tip}
                    onError={(e) =>
                      onDotaSteamAssetImgError(e, { tryAbilityFiller: true })
                    }
                  />
                </div>
              )}
              <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-max max-w-[260px] -translate-x-1/2 rounded-md border border-gray-200 bg-white px-1.5 py-1 text-[10px] leading-snug text-gray-800 shadow-lg transition-colors duration-200 ease-in-out group-hover:block dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {tip}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
