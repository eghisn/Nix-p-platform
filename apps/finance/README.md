# NIXP Finance

Private finance workspace served by the shared NIXP web app at `/finance`.

Production host target:

- `finance.nix-p.com`

Security model:

- Requires server login through `/api/auth/login`.
- Uses an HTTP-only signed session cookie.
- Reads private finance, inventory, order, and cashflow data only after authentication.
- Future order automation should update inventory through server routes, never directly from public client code.

