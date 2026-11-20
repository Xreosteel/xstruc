-- Supabase's default privileges let signed-in users call every function in public through the API, including the
-- SECURITY DEFINER trigger functions (audit, number_version), which the security advisor flags. Take that back and
-- grant only what the app calls: create_organisation (start an organisation) and the membership checks used by the
-- row-level-security policies and the approval route (they only ever answer about the caller's own memberships).
revoke execute on all functions in schema public from authenticated, anon, public;
grant execute on function public.create_organisation(text, text), public.is_member(uuid),
  public.has_role(uuid, public.member_role[]), public.can_write(uuid), public.can_admin(uuid),
  public.folder_org(text) to authenticated;
