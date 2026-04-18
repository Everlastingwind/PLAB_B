import { Link } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { SEOMeta } from "../components/SEOMeta";

export function NotFoundPage() {
  return (
    <>
      <SEOMeta title="页面未找到" />
      <PageShell>
        <main className="mx-auto max-w-lg px-4 py-16 text-center">
          <h1 className="mb-2 text-lg font-semibold text-skin-ink">404</h1>
          <p className="mb-6 text-sm text-skin-sub">该地址没有对应页面。</p>
          <Link
            to="/"
            className="text-sm font-medium text-amber-700 underline underline-offset-2 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
          >
            返回首页
          </Link>
        </main>
      </PageShell>
    </>
  );
}
