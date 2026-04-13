// Package replayparser registers Dota 2 legacy game-event talent tracking for manta replays.
//
// 设计说明（7.36+ 复杂状态）：
//   - 已废弃：在 p.OnEntity 中遍历 32 个技能槽位搜 special_bonus 的做法无法稳定捕获
//     克隆体、阵亡瞬间等状态下的天赋加点，故不得再依赖该路径作为主数据源。
//   - 本包以 dota_player_learned_ability 全局事件为准，在 GlobalTalentTracker 中永久记录，
//     与你管线「最后组装阶段」的回填逻辑对接（在最终 JSON 合并前读取 GlobalTalentTracker）。
package replayparser

import (
	"fmt"
	"os"
	"strings"

	"github.com/dotabuff/manta"
)

// GlobalTalentTracker：玩家槽位 (0–31) → 已确认学习的天赋 ability 名（含 special_bonus*）。
// 在单场解析开始前应 ResetGlobalTalentTracker；组装输出时读取并写回 talent / skill_build。
var GlobalTalentTracker = make(map[int32]map[string]bool)

// ResetGlobalTalentTracker 清空全局缓存，避免多场 replay 串数据。
func ResetGlobalTalentTracker() {
	GlobalTalentTracker = make(map[int32]map[string]bool)
}

// RegisterDotaPlayerLearnedAbilityTalentHook 注册 dota_player_learned_ability 拦截器。
// 必须在 p.Start() 之前调用。
func RegisterDotaPlayerLearnedAbilityTalentHook(p *manta.Parser) {
	p.OnGameEvent("dota_player_learned_ability", func(m *manta.GameEvent) error {
		pid, err := m.GetInt32("PlayerID")
		if err != nil {
			pid, err = m.GetInt32("player")
		}
		if err != nil || pid < 0 || pid >= 32 {
			return nil
		}
		abilityName, err := m.GetString("abilityname")
		if err != nil || abilityName == "" {
			return nil
		}
		if !strings.Contains(strings.ToLower(abilityName), "special_bonus") {
			return nil
		}
		if GlobalTalentTracker[pid] == nil {
			GlobalTalentTracker[pid] = make(map[string]bool)
		}
		GlobalTalentTracker[pid][abilityName] = true
		fmt.Printf("🔥 [事件拦截成功] 玩家 %d 点了天赋: %s\n", pid, abilityName)
		return nil
	})
}

// ParseReplay 读取 Source2 .dem，注册天赋事件监听后执行解析。
// 在 parseReplay 内于 p.Start() 之前插入 RegisterDotaPlayerLearnedAbilityTalentHook(p) 即等价于本函数中间段。
func ParseReplay(demPath string) error {
	buf, err := os.ReadFile(demPath)
	if err != nil {
		return err
	}
	p, err := manta.NewParser(buf)
	if err != nil {
		return err
	}
	ResetGlobalTalentTracker()
	RegisterDotaPlayerLearnedAbilityTalentHook(p)
	return p.Start()
}

// -----------------------------------------------------------------------------
// 装备：固定槽位（0–5 主栏、16 中立），禁止 append 动态数组导致空槽左移错位
// -----------------------------------------------------------------------------

// InventorySlotNeutral 为 Dota 2 实体上「中立饰品」在 m_hItems 链中的槽位索引（与主栏 0–5 区分）。
const InventorySlotNeutral = 16

// OpenDotaPlayerItemSlots 对齐 OpenDota match JSON 的键名 item_0 … item_5、item_neutral。
// 值为去掉 `item_` 前缀的内部名；空槽为 ""。若需与官方 API 完全一致（数值 item id），在序列化前用 item_ids 反查即可。
type OpenDotaPlayerItemSlots struct {
	Item0       string `json:"item_0"`
	Item1       string `json:"item_1"`
	Item2       string `json:"item_2"`
	Item3       string `json:"item_3"`
	Item4       string `json:"item_4"`
	Item5       string `json:"item_5"`
	ItemNeutral string `json:"item_neutral"`
}

// StripItemPrefix 移除 Valve 实体显示名上的 item_ 前缀，便于与 dotaconstants key 对齐。
func StripItemPrefix(itemName string) string {
	s := strings.TrimSpace(itemName)
	return strings.TrimPrefix(s, "item_")
}

// HeroInventorySlotLookup 由主程序注入：按 DOTA 身上 inventory 槽位索引（0–5 主栏、16 中立）
// 解析英雄实体上的 m_hItems.XXXX → handle → 物品实体 → 显示名；无物品或无效 handle 时返回 ""。
//
// 典型实现（伪代码，签名请与你们的 handleFromEntity / FindEntityByHandle 对齐）：
//
//	getItemBySlot := func(slot int) string {
//		key := fmt.Sprintf("m_hItems.%04d", slot)
//		h, ok := handleFromEntity(heroEnt, key)
//		if !ok || h == 0 {
//			return ""
//		}
//		itemEnt := p.FindEntityByHandle(h)
//		if itemEnt == nil {
//			return ""
//		}
//		itemName := entityDisplayName(p, itemEnt)
//		return replayparser.StripItemPrefix(itemName)
//	}
//	replayparser.FillHeroInventory(&pl.OpenDotaPlayerItemSlots, getItemBySlot)
type HeroInventorySlotLookup func(slot int) string

// FillHeroInventory 定点赋值主 6 格与中立项，无论空槽与否都不会产生数组平移或背包/附魔槽误入主栏索引。
func FillHeroInventory(pl *OpenDotaPlayerItemSlots, getItemBySlot HeroInventorySlotLookup) {
	if pl == nil || getItemBySlot == nil {
		return
	}
	pl.Item0 = getItemBySlot(0)
	pl.Item1 = getItemBySlot(1)
	pl.Item2 = getItemBySlot(2)
	pl.Item3 = getItemBySlot(3)
	pl.Item4 = getItemBySlot(4)
	pl.Item5 = getItemBySlot(5)
	pl.ItemNeutral = getItemBySlot(InventorySlotNeutral)
}
