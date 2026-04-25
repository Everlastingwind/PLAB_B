
import json
import os

# 新增：引入 supabase 客户端
from supabase import create_client, Client

def main():
    # ... 省略处理 slim 字典的所有上游逻辑 ...
    with open('some_file.json', 'w') as f:
        json.dump(slim, f, ensure_ascii=False, indent=2)

    # === 新增: 将 slim（去掉 _meta） upsert 到 supabase "plan_b" 表里 ===
    slim_for_db = {k: v for k, v in slim.items() if k != '_meta'}

    url = "https://wmshhvmqenjxypcmpewl.supabase.co"
    key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indtc2hodm1xZW5qeHlwY21wZXdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwOTMzNzgsImV4cCI6MjA5MTY2OTM3OH0.oQwdBj-PQP1O8nQAJytmYa2d9YKV6Iq9TgxxDktT644"
    supabase: Client = create_client(url, key)

    # 直接 upsert 一行（假定主键为 match_id，整个 slim_for_db 作为单行）
    try:
        resp = supabase.table("plan_b").upsert([slim_for_db]).execute()
        match_id = slim_for_db.get("match_id", "未知")
        print(f"✨ 成功同步至云端！比赛 ID: {match_id}")
    except Exception as e:
        print("❌ 同步至云端失败:", e)
