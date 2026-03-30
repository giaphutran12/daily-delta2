alter table public.pipeline_requests
  add column if not exists organization_id uuid references public.organizations(organization_id) on delete set null,
  add column if not exists requested_by_user_id uuid references public.users(user_id) on delete set null,
  add column if not exists recipient_user_ids uuid[] null;
