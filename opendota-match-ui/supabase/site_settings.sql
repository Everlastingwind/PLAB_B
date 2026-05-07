-- 全站补丁版本远程配置（单行）。执行后可在 Supabase Table Editor 中编辑，或由前端 PatchUpdatePanel / 脚本读取。
-- RLS：默认允许匿名读取（站点需公开 current_patch）；写入按需收紧（见注释）。

create table if not exists public.site_settings (
  id integer primary key check (id = 1),
  current_patch text not null,
  previous_patch text not null,
  updated_at timestamptz not null default now()
);

comment on table public.site_settings is '单行站点配置：当前/上一补丁号，供前端与上传脚本读取';

insert into public.site_settings (id, current_patch, previous_patch)
values (1, '7.41C', '7.41B')
on conflict (id) do nothing;

alter table public.site_settings enable row level security;

-- 浏览站点：任何人可读当前配置
create policy "site_settings_select_public"
  on public.site_settings
  for select
  using (true);

-- 开发面板 / 管理端需用 anon/service key 更新：若仅后台更新，可改为 auth.uid() 或单独 service role。
-- 生产环境请改为仅 service_role 或已登录管理员。
create policy "site_settings_update_panel"
  on public.site_settings
  for update
  using (true)
  with check (true);

create policy "site_settings_insert_singleton"
  on public.site_settings
  for insert
  with check (id = 1);
