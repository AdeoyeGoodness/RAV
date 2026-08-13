# RAV Production Deployment (Native / No-Docker)

Deployment notes for the RAV server as it is actually running today.
Host: **172.16.100.41** (VPS named `rav`). Companion app BUAS runs separately on
172.16.100.23 and is unrelated to this stack.

---

## 1. What this server does

A single VPS runs the entire RAV stack natively (no Docker). nginx is the only
process exposed to the network; everything else listens on loopback or is fronted
by nginx.

Clients on any of the three internal networks reach the dashboard and API at
`http://172.16.100.41`:

- `172.16.100.0/22`
- `10.0.0.0/22`
- `172.16.0.0/22`

These three subnets are the only ones allowed (enforced in nginx). Inter-network
routing between the subnets is handled outside this box.

---

## 2. Service inventory

| Component   | Listens on        | Managed by        | Notes |
|-------------|-------------------|-------------------|-------|
| nginx       | `0.0.0.0:80`      | systemd (`nginx`) | Reverse proxy + access control |
| Backend     | `127.0.0.1:8080`  | pm2 (`rav-backend`)   | Rust/axum API |
| Dashboard   | `127.0.0.1:3000`  | pm2 (`rav-dashboard`) | Next.js standalone server |
| PostgreSQL  | `127.0.0.1:5432`  | systemd (`postgresql`)| db `rav_db`, user `rav_user` |
| Redis       | `127.0.0.1:6379`  | systemd (`redis-server`) | |
| MinIO (S3)  | `127.0.0.1:9000`  | systemd (`minio`) | object storage |
| MinIO console | `127.0.0.1:9001` | systemd (`minio`) | admin UI |

The backend additionally writes some local files under
`~/RAV/backend/storage/` (`files/`, `archives/`) — this is relative to the
backend's working directory, which pm2 sets to `~/RAV/backend`.

---

## 3. Request routing (nginx)

Config: `/etc/nginx/sites-available/rav` (symlinked into `sites-enabled/`).
Source of truth in the repo: `deployment/nginx-rav.conf`.

| Path             | Proxied to            | Purpose |
|------------------|-----------------------|---------|
| `/api/`          | `127.0.0.1:8080`      | Backend REST API |
| `/minio/`        | `127.0.0.1:9000`      | S3 objects + presigned downloads (prefix stripped) |
| `/console/`      | `127.0.0.1:9001`      | MinIO admin console |
| `/_next/static/` | `127.0.0.1:3000`      | Dashboard static assets (long cache) |
| `/` (everything else) | `127.0.0.1:3000` | Next.js dashboard |

Note: the backend's bare `/health` route is NOT under `/api/`, so through nginx
it falls through to the dashboard. Health-probe the backend directly on
`127.0.0.1:8080/health`, or use any `/api/v1/*` route through nginx.

---

## 4. Environment files

### `~/RAV/backend/.env`
Read by the Rust backend on startup (keys come from `backend/src/config.rs`).

```
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8080
DATABASE_URL=postgresql://rav_user:<db-password>@localhost:5432/rav_db
S3_ENDPOINT=http://172.16.100.41/minio      # public URL — presigned URLs are signed against this
S3_ACCESS_KEY=rav-backend
S3_SECRET_KEY=<minio-secret>
S3_BUCKET=rav-evidence
REDIS_URL=redis://localhost:6379
JWT_SECRET=<random 48-byte base64>
CORS_ALLOWED_ORIGINS=http://172.16.100.41
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@rav-security.local
RUST_LOG=info
```

### `~/RAV/dashboard/.env.local`
Read by Next.js. `NEXT_PUBLIC_*` values are **baked into the JS bundle at build
time** — changing this requires a rebuild (`npm run build`).

```
NEXT_PUBLIC_API_URL=http://172.16.100.41
```

### `/etc/default/minio`
Read by the MinIO systemd unit. `chmod 600` (contains the secret).

```
MINIO_VOLUMES="/var/lib/minio"
MINIO_OPTS="--console-address :9001 --address :9000"
MINIO_ROOT_USER=rav-backend
MINIO_ROOT_PASSWORD=<minio-secret>
MINIO_SERVER_URL=http://172.16.100.41/minio
MINIO_BROWSER_REDIRECT_URL=http://172.16.100.41/console
```

**Credential coupling that must always hold:**
`S3_ACCESS_KEY` == `MINIO_ROOT_USER` and `S3_SECRET_KEY` == `MINIO_ROOT_PASSWORD`.
If these drift, the backend gets "Access Denied" from MinIO on every storage op.

---

## 5. First-time setup (what was done)

```bash
# System packages
sudo apt update
sudo apt install -y postgresql postgresql-contrib redis-server \
  build-essential libssl-dev pkg-config curl git
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash - && sudo apt install -y nodejs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
sudo npm install -g pm2

# MinIO binary + client
sudo curl -L https://dl.min.io/server/minio/release/linux-amd64/minio -o /usr/local/bin/minio
sudo chmod +x /usr/local/bin/minio
sudo curl -L https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
sudo chmod +x /usr/local/bin/mc

# Postgres role + db
sudo -u postgres psql -c "CREATE USER rav_user WITH PASSWORD '<db-password>';"
sudo -u postgres psql -c "CREATE DATABASE rav_db OWNER rav_user;"

# MinIO as a service (env in /etc/default/minio, unit in /etc/systemd/system/minio.service)
sudo useradd -r -s /sbin/nologin minio
sudo mkdir -p /var/lib/minio && sudo chown -R minio:minio /var/lib/minio
sudo chmod 600 /etc/default/minio
sudo systemctl daemon-reload && sudo systemctl enable --now minio

# Evidence bucket
mc alias set local http://127.0.0.1:9000 rav-backend '<minio-secret>'
mc mb local/rav-evidence

# Backend build + migrations
cd ~/RAV/backend
cargo install sqlx-cli --no-default-features --features postgres
export DATABASE_URL="postgresql://rav_user:<db-password>@localhost:5432/rav_db"
sqlx migrate run
cargo build --release

# Dashboard build (after .env.local exists)
cd ~/RAV/dashboard
npm ci
npm run build

# Start app processes + persist across reboot
cd ~/RAV/deployment
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd        # run the printed sudo command once

# nginx
sudo cp deployment/nginx-rav.conf /etc/nginx/sites-available/rav
sudo ln -s /etc/nginx/sites-available/rav /etc/nginx/sites-enabled/rav
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. Create the first admin

The backend exposes an (currently unauthenticated) registration endpoint. Use the
helper script with an explicit strong password:

```bash
cd ~/RAV
ADMIN_EMAIL='you@yourorg.com' ADMIN_PASSWORD='<strong-password>' node create_admin.js
# expect: Status Code: 200
```

Verify login:

```bash
curl -i -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@yourorg.com","password":"<strong-password>"}'
# expect: 200 + set-cookie: rav_token=...
```

Then log in from a browser at `http://172.16.100.41`.

---

## 7. Operations

```bash
# App processes
pm2 status
pm2 logs rav-backend --lines 50
pm2 logs rav-dashboard --lines 50
pm2 restart rav-backend
pm2 restart rav-dashboard

# Infra services
sudo systemctl status minio postgresql redis-server nginx
sudo systemctl restart minio
sudo systemctl reload nginx        # after editing the nginx config

# Apply a backend code change
cd ~/RAV/backend && cargo build --release && pm2 restart rav-backend

# Apply a dashboard code or env change (MUST rebuild)
cd ~/RAV/dashboard && npm run build && pm2 restart rav-dashboard

# Apply a new DB migration
cd ~/RAV/backend && sqlx migrate run && pm2 restart rav-backend
```

### Smoke test
```bash
curl -i http://127.0.0.1:8080/health                 # backend  -> 200 (empty body)
curl -i http://172.16.100.41/api/v1/agents           # via nginx -> 401 (auth working)
curl -I http://127.0.0.1:9000/minio/health/live      # minio    -> 200
curl -I http://172.16.100.41/minio/minio/health/live # minio via nginx -> 200
curl    http://172.16.100.41                          # dashboard HTML
```

---

## 8. Security follow-ups (open items)

These are known and intentionally deferred — track and close them:

1. **Open registration.** `/api/v1/auth/register` needs no auth, so anyone on the
   three subnets can create a `super_admin`. Lock this down (disable the route, or
   gate it behind an existing super_admin) once the first admin exists.
2. **No TLS.** All traffic is plain HTTP on `:80`, including JWT cookies and
   evidence uploads. Add TLS (internal CA + nginx `listen 443 ssl`, or Caddy) so
   credentials and forensic data aren't sniffable on the LAN.
3. **Rotate any secret that was ever pasted into a chat/terminal log**
   (`JWT_SECRET`, `S3_SECRET_KEY` / MinIO password, DB password). Rotating
   `JWT_SECRET` invalidates existing sessions (expected).
4. **CSP origin.** The backend sends a Content-Security-Policy whose `connect-src`
   references `https://yikes.cam`. Keep this in sync with the deployment domain if
   it ever changes (`backend/src/main.rs`); harmless when the dashboard is
   same-origin since `'self'` already covers it.
5. **MinIO console exposure.** `/console/` is reachable from all three subnets.
   Restrict it further (extra `allow`/`deny` in its nginx block) if the console
   should be admin-only.

---

## 9. Troubleshooting

| Symptom | Likely cause | Check |
|---------|-------------|-------|
| Dashboard loads, API calls fail | `NEXT_PUBLIC_API_URL` wrong/missing at build time | `cat dashboard/.env.local`, then rebuild |
| `502 Bad Gateway` on `/api/` | backend down | `pm2 status`, `pm2 logs rav-backend` |
| File downloads return `403 SignatureDoesNotMatch` | `MINIO_SERVER_URL` / `S3_ENDPOINT` mismatch | both must be `http://172.16.100.41/minio` |
| Backend "Access Denied" from MinIO | creds drift | `S3_ACCESS_KEY/SECRET` vs `MINIO_ROOT_USER/PASSWORD` |
| Backend won't start, DB error | wrong port/password | `DATABASE_URL` (native Postgres = 5432, not 5434) |
| Can't reach site from another subnet | nginx allow-list or routing | nginx `allow` blocks + inter-subnet routing |

---

## 10. Agent deployment & troubleshooting

The agent runs on monitored **endpoints** (not the server). It reads its config from
`C:\ProgramData\RAV\config.toml`, buffers events to `C:\ProgramData\RAV\rav_events.db`,
logs to `C:\ProgramData\RAV\logs\`, and runs as the Windows service **`RAVAgent`**
("RAV Monitoring Agent") under `LocalSystem`.

### Where the backend URL comes from

The agent builds requests as `{backend.url}/api/v1/...`, so `backend.url` must be the
server **fronted by nginx** — `http://172.16.100.41` (port 80, no `:8080`). It resolves
the URL in this order: `config.toml` → `--server` flag → `BACKEND_URL` env → compiled
default (now `http://172.16.100.41`). The MSI writes `config.toml` from its
`BACKEND_URL` property at install time.

### Deploying an agent (clean install)

```powershell
# On each endpoint, elevated PowerShell.
# 1. Clean any prior state so a stale config/queue can't linger (the MSI does NOT
#    overwrite an existing config.toml).
Remove-Item -Recurse -Force C:\ProgramData\RAV  -ErrorAction SilentlyContinue

# 2. Install, passing the URL and the org-generated enrollment token explicitly.
msiexec /i RAVAgent.msi BACKEND_URL="http://172.16.100.41" ENROLLMENT_TOKEN="<org-token>" /qn
```

Enrollment tokens are generated in the dashboard by an **org admin** (super admin →
create organization → org admin → generate enrollment token).

### MANDATORY pre-flight check (do this first, every time)

Most agent "failures" are actually the endpoint not being able to reach the server.
Before blaming the agent, prove reachability **from that endpoint, at that moment**:

```powershell
ipconfig | Select-String "IPv4"                                # must be in 172.16.x / 10.0.x (an allowed subnet)
curl.exe -i --max-time 10 http://172.16.100.41/api/v1/agents   # must return HTTP 401
```

If the `curl` does not return `401`, **fix the network first** — do not touch the agent.
Endpoints must be on a network/subnet that routes to `172.16.100.41` (Ethernet, or a
machine-wide Wi-Fi profile). A laptop roaming between many Wi-Fi networks is the classic
cause of intermittent agent failure.

### Reading the agent log

```powershell
$log = (Get-ChildItem "C:\ProgramData\RAV\logs\*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
Get-Content $log -Tail 20 -Wait
```

| Log line | Meaning | Action |
|----------|---------|--------|
| `Enrollment request failed` (+ `os error 10060`) | TCP connect timed out — **can't reach the server** | network problem — run the pre-flight check |
| `Enrollment denied 401` | reached the server, but the **token** was rejected | regenerate the enrollment token in the dashboard; check the org is `active` |
| `Resuming session for Organization: …` / `Agent session active` | **enrolled OK** | — |
| `Discarding N … not tagged with current identity` | draining a stale pre-enrollment backlog | normal once; if persistent, see below |
| `Pushing N buffered events to backend...` | events are being POSTed to `/api/v1/events` | working |

### Service control

```powershell
Get-Service RAVAgent
Restart-Service RAVAgent
```

### "Device shows up but no events"

The agent buffers events tagged with its identity and only sends events matching the
**current** enrolled identity; mismatched ones are discarded. If a large backlog built
up while the agent was offline/unenrolled, it drains 100-at-a-time (oldest first), so
new events can take several minutes to appear. To skip the backlog immediately (those
events are discarded anyway, never sent):

```powershell
Stop-Service RAVAgent
Remove-Item C:\ProgramData\RAV\rav_events.db* -Force
Start-Service RAVAgent
```

The agent id is derived deterministically from the hardware fingerprint
(`{hostname}-{fingerprint}`), so a reinstall/config-reset reuses the same id — it hits
the same backend device row and keeps previously-buffered events valid (no orphaning).

### Don't run the agent with no flags to "test" it

Running `rav-agent.exe` with no arguments starts it in service/foreground mode logging
to the **file**, not the console — so it looks like nothing happens. To test enrollment
visibly, stop the service and use the one-shot enroll (prints to console):

```powershell
Stop-Service RAVAgent
& "C:\Program Files (x86)\RAV Agent\rav-agent.exe" --server "http://172.16.100.41" --enroll "<token>"
```
