import {
  itemIconUrl,
  normalizeDotaAssetUrl,
  steamCdnImgDefer,
} from "../data/mockMatchPlayers";
import type {
  ItemOverlay,
  ItemSlotMock,
  PlayerBuffsMock,
} from "../data/mockMatchPlayers";
import { cn } from "../lib/cn";

const RAISED =
  "rounded-md border border-gray-200 bg-white shadow-sm transition-colors duration-200 ease-in-out dark:border-slate-600 dark:bg-slate-700/90 dark:shadow-none";

function ItemOverlayBadge({ overlay }: { overlay: ItemOverlay }) {
  return (
    <span
      className="pointer-events-none absolute bottom-0.5 right-0.5 z-[2] max-w-[calc(100%-2px)] truncate rounded-[1px] bg-gray-900/90 px-0.5 py-px font-mono text-[8px] leading-none text-amber-400 transition-colors duration-200 ease-in-out dark:bg-slate-950/90"
      title={
        overlay.kind === "charges"
          ? "充能 / 时间"
          : overlay.kind === "cd"
            ? "冷却"
            : "时间"
      }
    >
      {overlay.text}
    </span>
  );
}

/** 固定 6 主槽：只读索引 0–5，忽略多余元素，绝不遍历「购买记录」类动态数组 */
function sixMainSlots(
  main: readonly (ItemSlotMock | null)[] | null | undefined
): [ItemSlotMock | null, ItemSlotMock | null, ItemSlotMock | null, ItemSlotMock | null, ItemSlotMock | null, ItemSlotMock | null] {
  const a = main ?? [];
  return [
    a[0] ?? null,
    a[1] ?? null,
    a[2] ?? null,
    a[3] ?? null,
    a[4] ?? null,
    a[5] ?? null,
  ];
}

const EMPTY_MAIN =
  "h-8 w-8 shrink-0 rounded-[4px] border border-slate-600/40 bg-slate-800/50 dark:border-slate-600/50 dark:bg-slate-800/50";

function ItemIcon({ slot }: { slot: ItemSlotMock | null }) {
  if (!slot) {
    return (
      <div className={cn(EMPTY_MAIN)} aria-hidden title="空物品格" />
    );
  }
  return (
    <div
      className={cn(
        "relative h-8 w-8 shrink-0 overflow-hidden rounded-[4px]",
        RAISED
      )}
    >
      <img
        src={
          normalizeDotaAssetUrl(slot.imageUrl?.trim() ?? "") ||
          itemIconUrl(slot.itemKey)
        }
        alt=""
        className="h-full w-full object-cover"
        {...steamCdnImgDefer}
      />
      {slot.overlay ? <ItemOverlayBadge overlay={slot.overlay} /> : null}
    </div>
  );
}

const AGHANIM_SCEPTER_IMG = itemIconUrl("ultimate_scepter");
const AGHANIM_SHARD_IMG = itemIconUrl("aghanims_shard");

function AghanimPairInSlot({
  buffs,
}: {
  buffs: Pick<PlayerBuffsMock, "aghanims">;
}) {
  const hasScepter =
    buffs.aghanims === "scepter" || buffs.aghanims === "both";
  const hasShard = buffs.aghanims === "shard" || buffs.aghanims === "both";

  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 flex-col items-center justify-center gap-px rounded-[4px] border border-slate-600/40 bg-slate-800/40 px-0.5 py-px dark:border-slate-600/50 dark:bg-slate-800/50"
      )}
      aria-label="阿哈利姆神杖与魔晶"
    >
      <img
        src={AGHANIM_SCEPTER_IMG}
        alt=""
        className={cn(
          "h-[14px] w-[14px] rounded-[1px] object-cover",
          !hasScepter && "opacity-[0.38] grayscale-[0.85]"
        )}
        title={hasScepter ? "已购买神杖" : "未购买神杖"}
        {...steamCdnImgDefer}
      />
      <img
        src={AGHANIM_SHARD_IMG}
        alt=""
        className={cn(
          "h-[14px] w-[14px] rounded-[1px] object-cover",
          !hasShard && "opacity-[0.38] grayscale-[0.85]"
        )}
        title={hasShard ? "已购买魔晶" : "未购买魔晶"}
        {...steamCdnImgDefer}
      />
    </div>
  );
}

interface ItemSlotStripProps {
  main: (ItemSlotMock | null)[];
  backpack?: (ItemSlotMock | null)[];
  aghanimsBuffs?: Pick<PlayerBuffsMock, "aghanims">;
}

/**
 * 固定 6 主槽，单行不换行；空槽占位尺寸与有物品时一致。
 * 背包、购买记录等不得参与本行宽度计算。
 */
export function ItemSlotStrip({
  main,
  backpack: _backpack,
  aghanimsBuffs,
}: ItemSlotStripProps) {
  void _backpack;
  const six = sixMainSlots(main);

  return (
    <div className="min-w-0 w-full max-w-full">
      <div
        className={cn(
          "flex w-full min-w-0 max-w-full flex-nowrap items-center justify-start gap-2 overflow-hidden"
        )}
      >
        <div
          className="grid shrink-0 grid-cols-6 gap-2"
          role="list"
          aria-label="主物品栏（6 格）"
        >
          {six.map((s, i) => (
            <ItemIcon key={i} slot={s} />
          ))}
        </div>
      </div>
      {aghanimsBuffs ? (
        <div className="mt-1 flex min-w-0 shrink-0">
          <AghanimPairInSlot buffs={aghanimsBuffs} />
        </div>
      ) : null}
    </div>
  );
}
