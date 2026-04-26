import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";

type Props = {
  index: number;
  /** 前几条始终挂载子树（用于 eager 图与首屏） */
  forceMountCount?: number;
  /** 视口外提前量，越大越早挂载 */
  rootMargin?: string;
  className?: string;
  /** 未进入视口时的占位块 */
  skeleton?: ReactNode;
  children: ReactNode;
};

/**
 * 仅当行进入视口（±rootMargin）后才挂载子节点，减轻首屏大量 <img> 与浏览器 lazy 干预。
 * 已进入过视口的行会保持挂载，避免来回滚动时闪烁。
 */
export function ViewportMountRow({
  index,
  forceMountCount = 2,
  rootMargin = "280px 0px",
  className,
  skeleton,
  children,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const force = index < forceMountCount;
  const [mounted, setMounted] = useState(force);

  useEffect(() => {
    if (force || mounted) return;
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (ents) => {
        for (const e of ents) {
          if (e.isIntersecting) {
            setMounted(true);
            io.disconnect();
            break;
          }
        }
      },
      { root: null, rootMargin, threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [force, mounted, rootMargin]);

  const defaultSkeleton = (
    <div
      aria-hidden
      className="min-h-[4.25rem] bg-skin-inset/40 sm:min-h-[5.75rem]"
    />
  );

  return (
    <div ref={wrapRef} className={cn(className)}>
      {mounted ? children : (skeleton ?? defaultSkeleton)}
    </div>
  );
}
