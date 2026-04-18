import { useEffect, useRef, useState } from "react";

type Status = "idle" | "sending" | "sent";

/**
 * 全局悬浮反馈：纯前端直连 PushPlus API。
 * TODO: 将 PUSHPLUS_TOKEN 替换成你自己的 PushPlus Token。
 */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TODO: 在这里替换为你自己的 PushPlus Token。
  const PUSHPLUS_TOKEN = "3ad0facf1d5e4ab6a3f4b2846e6ba2ab";

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handleSend = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || status === "sending") return;

    setStatus("sending");

    try {
      const res = await fetch("https://www.pushplus.plus/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: PUSHPLUS_TOKEN,
          title: "【网站新反馈】",
          content: trimmedMessage,
          template: "html",
        }),
      });

      const raw = await res.text();
      let parsed: { code?: number; msg?: string } | null = null;
      try {
        parsed = raw ? (JSON.parse(raw) as { code?: number; msg?: string }) : null;
      } catch {
        parsed = null;
      }

      if (!res.ok) {
        throw new Error(parsed?.msg || `HTTP ${res.status}`);
      }

      if (!parsed || parsed.code !== 200) {
        throw new Error(parsed?.msg || "PushPlus 返回异常，请检查 token 或接口状态。");
      }

      setStatus("sent");
      timerRef.current = setTimeout(() => {
        setOpen(false);
        setMessage("");
        setStatus("idle");
        timerRef.current = null;
      }, 2000);
    } catch (error) {
      setStatus("idle");
      const msg = error instanceof Error ? error.message : "未知错误";
      alert(`发送失败：${msg}`);
    }
  };

  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2 text-sm">
      {open ? (
        <div className="w-[min(100vw-2rem,22rem)] border border-black bg-white p-3">
          <textarea
            className="mb-3 min-h-[112px] w-full resize-none border-0 border-b-2 border-black bg-transparent px-0 py-2 text-black outline-none placeholder:text-neutral-500"
            placeholder="无需注册，有建议或发现 Bug 直接输入后发送即可"
            value={message}
            disabled={status !== "idle"}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="text-neutral-500"
              disabled={status === "sending"}
              onClick={() => {
                setOpen(false);
                setMessage("");
                setStatus("idle");
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="bg-black px-3 py-1.5 text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={status === "sending" || status === "sent" || !message.trim()}
              onClick={() => void handleSend()}
            >
              {status === "sending" ? "发送中..." : status === "sent" ? "已发送" : "发送"}
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="rounded-full bg-black px-4 py-2 text-white"
        onClick={() => {
          setOpen((v) => !v);
          if (open) {
            setMessage("");
            setStatus("idle");
          }
        }}
        aria-expanded={open}
      >
        问题反馈
      </button>
    </div>
  );
}
