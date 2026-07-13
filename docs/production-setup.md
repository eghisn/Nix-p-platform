# NIXP Production Setup

## Namecheap DNS

Set these records for `nix-p.com`:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| CNAME | `admin` | `cname.vercel-dns.com` | Automatic |
| CNAME | `finance` | `cname.vercel-dns.com` | Automatic |

After DNS resolves, add/verify both domains on the Vercel `nix-p-platform` project:

- `admin.nix-p.com`
- `finance.nix-p.com`

## Vercel Production Environment Variables

Set these in Vercel Project Settings > Environment Variables for Production:

```txt
SUPABASE_URL=https://ozxkbmexuiuuhjvohxbb.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NIXP_SESSION_SECRET=
NIXP_ADMIN_USERNAME=operatorwebsite
NIXP_ADMIN_PASSWORD=
NIXP_FINANCE_USERNAME=operatorfinance
NIXP_FINANCE_PASSWORD=
GITHUB_TOKEN=
GITHUB_REPOSITORY=eghisn/Nix-p-platform
GITHUB_BRANCH=main
```

Do not commit the real values. The GitHub token must be a fine-grained token with access to `eghisn/Nix-p-platform` and Contents read/write permission.

## Supabase GitHub Integration

In Supabase project `ozxkbmexuiuuhjvohxbb`:

1. Open Project Settings > Integrations.
2. Authorize GitHub.
3. Select repository `eghisn/Nix-p-platform`.
4. Set Working directory to `.` because the `supabase/` folder is at the repository root.
5. Enable production deploys from `main` after confirming migrations are reviewed.
