# Launching X Struc (backlog #38)

Baji, 2026-11-20: **no sign-in for now; each device keeps its own jobs.** The web app opens straight to the projects
on that device (kept in the browser, with Backup / Restore files to keep a copy or move them). It needs no database and
no settings, so putting it online is one import on Vercel.

## Put it online (Baji, once)

1. vercel.com › Add New › Project › Import Git Repository › `Xreosteel/xstruc` (allow Vercel's GitHub app on the
   Xreosteel org if asked).
2. Root Directory: `apps/web`. Leave everything else as Vercel detects it (Next.js, pnpm). **No environment variables.**
   (If any were added during an earlier import, they do nothing unless `NEXT_PUBLIC_ACCOUNTS=1` is also set.)
3. Deploy. `apps/web/vercel.json` puts the server in Sydney (`syd1`). Every push to `main` deploys again.
4. Open the address Vercel gives (e.g. `https://xstruc.vercel.app`): Projects, New project, New floor or panel.

Jobs live in the browser that made them: another computer, another browser or a cleared browser starts empty. Use
**Backup** (a `.json` file) to keep a copy, and **Restore** on the other device to carry the jobs over.

---

# Later: accounts (sign-in, organisations, shared jobs)

Everything below is built and switched off. Turn it on with `NEXT_PUBLIC_ACCOUNTS=1` plus the Supabase settings in
Vercel, then the Supabase sign-in addresses. Note: a free Supabase project pauses after a week without use; restore it
from the dashboard before switching accounts on.

## Database: done (2026-11-20)

Supabase project **xstruc** in Xreosteel's Org, region **ap-southeast-2 (Sydney)**:
`https://fpigjtyjmsfmxawytmfe.supabase.co`. Migrations applied through the Supabase connector:
`20261120030824_foundation`, `20261120030903_function_grants` (the repo's `supabase/migrations` file names match the
applied versions). Security advisor: three notes left, all intended (`create_organisation` is how a signed-in user
starts an organisation; `has_role` / `is_member` only answer about the caller's own memberships and back the
row-level-security policies).

Public settings (safe to publish; row-level security protects the data):

```
NEXT_PUBLIC_SUPABASE_URL=https://fpigjtyjmsfmxawytmfe.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_s7EB40id3h86P_KsxTcOhA_vCcIQ4Sb
```

The server-only `SUPABASE_SERVICE_ROLE_KEY` is the project's **secret** key (Supabase dashboard › Project Settings ›
API Keys). It goes only into Vercel's environment variables, never into the repo or a chat.

## Web app on Vercel with accounts

1. vercel.com › Add New › Project › Import Git Repository › `Xreosteel/xstruc` (allow Vercel's GitHub app on the
   Xreosteel org if asked).
2. Root Directory: `apps/web` (Vercel finds Next.js and pnpm; leave the build settings as detected).
3. Environment Variables: `NEXT_PUBLIC_ACCOUNTS=1`, the two public settings above, plus `SUPABASE_SERVICE_ROLE_KEY` = the secret key.
4. Deploy. `apps/web/vercel.json` puts the server functions in Sydney (`syd1`).
5. Copy the production address (e.g. `https://xstruc.vercel.app`).

## Sign-in addresses in Supabase (Baji, once, after step 5)

Supabase dashboard › Authentication › URL Configuration:

- Site URL: the Vercel production address.
- Redirect URLs: `https://<that address>/auth/callback` and `https://*-xreosteel.vercel.app/auth/callback` (previews;
  use the team slug Vercel shows), plus `http://localhost:3000/auth/callback` for local work.

Email links then work, opened in the browser that asked for them.

Recommended, so a link asked for on the office PC also opens on a phone: Supabase › Authentication › Emails ›
**Magic Link** template, set the link to

```
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Sign in to X Struc</a>
```

(and the same with `type=signup` in the **Confirm signup** template). `/auth/callback` accepts both kinds of link.

Supabase's built-in email sender is rate-limited (a few emails an hour), enough for a pilot; set
up SMTP (e.g. Microsoft 365) before inviting many people. Microsoft 365 sign-in needs an Azure app registration that
an XREO Microsoft 365 admin approves (Supabase › Authentication › Providers › Azure); then set `NEXT_PUBLIC_MICROSOFT_SIGN_IN=1` in Vercel to show the
button.

## First use

1. Open the app, sign in with your email link, start the organisation **XREO** (you become its owner).
2. Team page: invite colleagues by email with a role (owner, admin, approver, detailer, site, viewer).
3. Create a project, add a floor or panel, Build, save a draft, approve.
