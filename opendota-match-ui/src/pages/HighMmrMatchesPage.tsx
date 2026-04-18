import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { PageShell } from "../components/PageShell";
import { SEOMeta } from "../components/SEOMeta";

type Row = Record<string, unknown>;

export function HighMmrMatchesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const client = supabase;
      if (!client) {
        setError(
          "未配置 Supabase：请在仓库根目录 .env.local 填写 URL 与 anon key，保存后重启 npm run dev"
        );
        setRows([]);
        setLoading(false);
        return;
      }
      const run = async (orderCol: string) =>
        client
          .from("high_mmr_matches")
          .select("*")
          .order(orderCol, { ascending: false })
          .limit(10);

      let { data, error: err } = await run("created_at");
      if (err && /created_at|column/i.test(String(err.message))) {
        ({ data, error: err } = await run("match_id"));
      }
      if (err && /match_id|column/i.test(String(err.message))) {
        ({ data, error: err } = await run("id"));
      }
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setRows([]);
      } else {
        setRows((data as Row[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const columns =
    rows.length > 0
      ? Object.keys(rows[0])
      : ([] as string[]);

  return (
    <>
      <SEOMeta title="高分局对局数据" />
      <PageShell>
      <main className="mx-auto max-w-[1200px] px-4 py-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold text-black">high_mmr_matches（最新 10 条）</h1>
          <Link
            to="/"
            className="text-sm text-black underline underline-offset-2 hover:no-underline"
          >
            返回首页
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-black">加载中…</p>
        ) : error ? (
          <p className="text-sm text-black">错误：{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-black">暂无数据。</p>
        ) : (
          <div className="overflow-x-auto border border-black">
            <table className="w-full border-collapse text-left text-sm text-black">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c}
                      className="border border-black bg-white px-2 py-1.5 font-semibold"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="bg-white even:bg-neutral-100">
                    {columns.map((c) => (
                      <td
                        key={c}
                        className="border border-black px-2 py-1.5 font-mono text-xs"
                      >
                        {formatCell(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </PageShell>
    </>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
