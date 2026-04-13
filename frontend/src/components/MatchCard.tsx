import React from "react";

/** 与 translate_match_data 输出对齐的精简玩家类型 */
export type TranslatedPlayer = {
  account_id?: number;
  player_slot?: number;
  hero_id?: number;
  hero_name_cn?: string;
  hero_name_en?: string;
  hero_portrait_url?: string;
  hero_icon_url?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  items_slot?: Array<{
    slot: number;
    item_id: number;
    item_key: string | null;
    item_name_en: string;
    item_name_cn: string;
    image_url: string;
    empty: boolean;
  }>;
  ability_timeline?: Array<{
    time: number | null;
    ability_id: number;
    ability_key: string | null;
    ability_name_en: string;
    ability_name_cn: string;
    image_url: string;
    is_talent: boolean;
  }>;
};

export type MatchCardProps = {
  matchId: number;
  radiantWin?: boolean;
  duration?: number;
  players: TranslatedPlayer[];
};

export const MatchCard: React.FC<MatchCardProps> = ({
  matchId,
  radiantWin,
  duration,
  players,
}) => {
  return (
    <article className="match-card">
      <header>
        <h2>比赛 #{matchId}</h2>
        {duration != null && <p>时长 {Math.floor(duration / 60)} 分 {duration % 60} 秒</p>}
        {radiantWin != null && (
          <p>胜者：{radiantWin ? "天辉" : "夜魇"}</p>
        )}
      </header>
      <ul className="match-card__roster">
        {players.map((p, idx) => (
          <li key={`${p.account_id ?? idx}-${p.player_slot ?? idx}`}>
            <HeroStats player={p} />
          </li>
        ))}
      </ul>
    </article>
  );
};

export const HeroStats: React.FC<{ player: TranslatedPlayer }> = ({ player }) => {
  return (
    <div className="hero-stats">
      {player.hero_portrait_url ? (
        <img
          className="hero-stats__portrait"
          src={player.hero_portrait_url}
          alt={player.hero_name_cn ?? ""}
          width={64}
          height={36}
        />
      ) : null}
      <div>
        <strong>{player.hero_name_cn ?? player.hero_name_en ?? "未知英雄"}</strong>
        <span className="hero-stats__kda">
          {" "}
          {player.kills ?? 0}/{player.deaths ?? 0}/{player.assists ?? 0}
        </span>
      </div>
      <div className="hero-stats__items">
        {(player.items_slot ?? []).map((it) =>
          it.empty ? (
            <span key={it.slot} className="item-slot item-slot--empty" />
          ) : (
            <img
              key={it.slot}
              className="item-slot"
              src={it.image_url}
              title={`${it.item_name_cn} (${it.item_name_en})`}
              alt={it.item_name_cn}
              width={32}
              height={24}
            />
          )
        )}
      </div>
    </div>
  );
};

export default MatchCard;
