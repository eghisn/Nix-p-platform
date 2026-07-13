# NIXP Admin

Private admin editor workspace served by the shared NIXP web app at `/admin`.

Production host target:

- `admin.nix-p.com`

Security model:

- Requires server login through `/api/auth/login`.
- Uses an HTTP-only signed session cookie.
- Writes product, artist, collection, inventory, request, order, and cashflow data through server API routes.
- Server API routes use `SUPABASE_SERVICE_ROLE_KEY`; the service role key must never be exposed to client code.

