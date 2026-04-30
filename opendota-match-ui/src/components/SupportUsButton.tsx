import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

const SUPPORT_BODY =
  "网站的开发和维护费用远超预期，如果你觉得网站的数据分析对你有帮助，欢迎支持一下，你们的每一份心意，都是网站持续运转的动力，万分感谢！";

const triggerClass = cn(
  "shrink-0 rounded-lg border border-slate-200/95 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition-colors",
  "hover:border-rose-200/75 hover:bg-rose-50/55 hover:text-rose-900/95",
  "dark:border-slate-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:border-rose-300/60 dark:hover:bg-rose-50/40 dark:hover:text-rose-950"
);

type SupportUsContextValue = {
  open: boolean;
  openModal: () => void;
  close: () => void;
};

const SupportUsContext = createContext<SupportUsContextValue | null>(null);

function useSupportUs(): SupportUsContextValue | null {
  return useContext(SupportUsContext);
}

function SupportUsModalDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/55 backdrop-blur-[3px] transition-opacity dark:bg-black/60"
        aria-label="关闭打赏弹窗"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-modal-title"
        className={cn(
          "relative z-10 w-full max-w-md rounded-xl border border-slate-200/90 bg-white p-5 shadow-2xl shadow-slate-900/15",
          "dark:border-slate-600 dark:bg-slate-900 dark:shadow-black/40"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="关闭"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        <h2
          id="support-modal-title"
          className="mb-3 pr-10 text-center text-base font-semibold text-slate-800 dark:text-slate-100"
        >
          支持 PlanB
        </h2>
        <p className="mb-5 text-sm leading-relaxed text-slate-600 text-justify dark:text-slate-400 sm:text-[0.9375rem]">
          {SUPPORT_BODY}
        </p>
        <div className="flex flex-wrap items-start justify-center gap-6 sm:gap-8">
          <div className="flex w-[128px] flex-col items-center gap-1.5">
            <img
              src="/images/wechat.png"
              alt="微信收款码"
              width={128}
              height={128}
              className="h-32 w-32 rounded-md border border-slate-200/80 object-cover dark:border-slate-600"
              loading="lazy"
            />
            <span className="text-center text-xs text-slate-500 dark:text-slate-400">
              微信扫码
            </span>
          </div>
          <div className="flex w-[128px] flex-col items-center gap-1.5">
            <img
              src="/images/alipay.png"
              alt="支付宝收款码"
              width={128}
              height={128}
              className="h-32 w-32 rounded-md border border-slate-200/80 object-cover dark:border-slate-600"
              loading="lazy"
            />
            <span className="text-center text-xs text-slate-500 dark:text-slate-400">
              支付宝扫码
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** 包住带 centerSearch 的页头，使桌面/手机两个触发器共用同一弹窗 */
export function SupportUsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openModal = useCallback(() => setOpen(true), []);
  const value = useMemo(
    () => ({ open, openModal, close }),
    [open, close, openModal]
  );

  return (
    <SupportUsContext.Provider value={value}>
      {children}
      <SupportUsModalDialog open={open} onClose={close} />
    </SupportUsContext.Provider>
  );
}

/** 搜索行右侧：仅 md 及以上显示 */
export function SupportUsHeaderDesktopTrigger() {
  const ctx = useSupportUs();
  if (!ctx) return null;
  return (
    <button
      type="button"
      onClick={ctx.openModal}
      className={cn(
        triggerClass,
        "hidden shrink-0 items-center justify-center md:inline-flex"
      )}
    >
      ❤️ 支持一下
    </button>
  );
}

/** LOGO 下方：仅小于 md 显示 */
export function SupportUsHeaderMobileTrigger() {
  const ctx = useSupportUs();
  if (!ctx) return null;
  return (
    <button
      type="button"
      onClick={ctx.openModal}
      className={cn(
        triggerClass,
        "inline-flex items-center justify-center self-start md:hidden"
      )}
    >
      ❤️ 支持一下
    </button>
  );
}
