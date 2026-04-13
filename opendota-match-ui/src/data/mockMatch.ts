import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  TrendingUp,
  Route,
  Sword,
  Coins,
  Package,
  LineChart,
  Eye,
  MousePointer2,
  MessageCircle,
  BookOpen,
  FileText,
} from "lucide-react";

/** 页眉数据结构 */
export interface MatchHeaderData {
  winnerSide: "radiant" | "dire";
  winnerTeamName: string;
  winnerLabel: string;
  scoreRadiant: number;
  scoreDire: number;
  gameMode: string;
  duration: string;
  endedAgo: string;
  leagueLabel: string;
  leagueName: string;
  matchId: string;
}

/** 页眉 Mock */
export const mockMatchHeader: MatchHeaderData = {
  winnerSide: "radiant",
  winnerTeamName: "BIZ GAMING",
  winnerLabel: "胜利",
  scoreRadiant: 43,
  scoreDire: 24,
  gameMode: "队长模式",
  duration: "39:47",
  endedAgo: "结束于 13 HOURS 之前",
  leagueLabel: "LEAGUE",
  leagueName: "CCT Dota 2 Season 2 South America Series 4",
  matchId: "8766353410",
};

export type NavTabId =
  | "overview"
  | "performance"
  | "laning"
  | "combat"
  | "farm"
  | "items"
  | "graphs"
  | "vision"
  | "actions"
  | "chat"
  | "story"
  | "logs";

export interface NavTabItem {
  id: NavTabId;
  label: string;
  icon: LucideIcon;
}

/** 选项卡顺序；默认激活「物品」 */
export const navTabs: NavTabItem[] = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "performance", label: "表现", icon: TrendingUp },
  { id: "laning", label: "分路", icon: Route },
  { id: "combat", label: "战斗", icon: Sword },
  { id: "farm", label: "打钱", icon: Coins },
  { id: "items", label: "物品", icon: Package },
  { id: "graphs", label: "曲线图", icon: LineChart },
  { id: "vision", label: "视野", icon: Eye },
  { id: "actions", label: "操作", icon: MousePointer2 },
  { id: "chat", label: "聊天", icon: MessageCircle },
  { id: "story", label: "战报", icon: BookOpen },
  { id: "logs", label: "记录", icon: FileText },
];

export const defaultActiveTab: NavTabId = "items";
