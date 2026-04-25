/** public/data/replays_index.json */
export interface ReplayPlayerSummary {
  player_slot: number;
  account_id: number;
  hero_id: number;
  /** 职业选手注册名；索引里常为 null，列表/英雄页会用种子名单按 account_id 补全 */
  pro_name: string | null;
  /** 录像内昵称（Supabase / 部分索引）；用于搜索非职业玩家 */
  personaname?: string | null;
  /** 对线期推断位置（可选）：carry/mid/offlane/support(4)/support(5) */
  role_early?: string | null;
  is_radiant: boolean;
  kills: number;
  deaths: number;
  assists: number;
}

export interface ReplaySummary {
  match_id: number;
  uploaded_at: string;
  /** 与比赛 JSON 一致：pub=本地录像隔离；pro=OpenDota 管线 */
  match_tier?: "pub" | "pro";
  /** 前端合并索引时注入来源：OpenDota=pro，本地上传=pub */
  source?: "pub" | "pro";
  duration_sec: number;
  radiant_win: boolean;
  league_name: string;
  /** 天辉 / 夜魇人头比分；缺省时 UI 用各队击杀之和估算 */
  radiant_score?: number;
  dire_score?: number;
  players: ReplayPlayerSummary[];
}

export interface ReplaysIndexPayload {
  version: number;
  replays: ReplaySummary[];
  /** 职业索引由脚本写入的元信息 */
  _meta?: Record<string, unknown>;
}
