-- Schlüssel erneuern ohne SECURITY DEFINER: Mitglieder dürfen die Zeile per RLS ohnehin ändern.
create or replace function public.postfach_token_erneuern()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  neu text;
begin
  if not privat.ist_mitglied() then
    raise exception 'keine Berechtigung';
  end if;
  neu := encode(extensions.gen_random_bytes(24), 'hex');
  update public.postfach set token = neu where id = 1;
  return neu;
end;
$$;
revoke all on function public.postfach_token_erneuern() from public, anon;
grant execute on function public.postfach_token_erneuern() to authenticated;

-- Hinweis: pg_net (20261015010100_pg_net.sql) wurde nur für Tests der Edge Functions gebraucht und kann
-- im Dashboard unter Database → Extensions wieder ausgeschaltet werden. Im echten Projekt weglassen.
