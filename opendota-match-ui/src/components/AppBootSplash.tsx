/** 首屏 / 站点补丁加载占位，样式见 index.html 内联 `.app-boot-splash` */
export function AppBootSplash() {
  return (
    <div
      className="app-boot-splash"
      role="status"
      aria-live="polite"
      aria-label="正在加载"
    >
      <p className="app-boot-logo" aria-hidden>
        <span>PL</span>
        <img src="/dota-a-mark.png" alt="" width={28} height={28} decoding="async" />
        <span>NB</span>
      </p>
      <div className="app-boot-progress" aria-hidden>
        <span className="app-boot-progress__bar" />
      </div>
    </div>
  );
}
