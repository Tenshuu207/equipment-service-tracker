# Crown Service Equipment Tracker — Docker Setup

Everything you need to run the full stack (Next.js + PostgreSQL) on your home server.

---

## What runs

| Container     | What it is                          | Port        |
|---------------|-------------------------------------|-------------|
| `crown_db`    | PostgreSQL 16                       | 5432        |
| `crown_db_init` | One-shot migration + seed runner  | (exits)     |
| `crown_app`   | Next.js 16 production server        | 3000        |

All data persists in a Docker volume (`pgdata`). Restarting containers does not lose records.

---

## First-time setup

### 1. Download the project

Click **three dots → Download ZIP** in v0, or clone from your connected GitHub repo.

### 2. Create your .env file

```bash
cp docker.env.example .env
```

Edit `.env` if you want to change the Postgres password or the host port.

### 3. Build and start

```bash
docker compose up --build
```

On first run `db-init` applies the schema and seeds the six real Dennis Food Service work orders, then exits. The app container waits for `db-init` to complete before starting.

### 4. Open the app

```
http://localhost:3000
```

Or replace `localhost` with your server's LAN IP.

---

## Daily use

```bash
# Start (after first build)
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f app

# Rebuild after code changes
docker compose up --build
```

---

## Uploading files

Go to **Import History** in the app and drag your Crown service confirmation files (.pdf, .msg, or .eml) onto the drop zone.

The server extracts text using `pdf-parse`, the parser runs the Crown regex logic, and the result is written directly to PostgreSQL. The dashboard updates immediately after clicking "Import to Database".

### Bulk / automated ingestion (future)

The app container mounts a local `./imports/` folder at `/app/imports`. You can point a Windows Scheduled Task or a Linux cron job to copy files from your Dennis network share into `./imports/incoming/`. A file-watcher service (to be added) will pick them up automatically.

---

## Connecting a database client

From any machine on your LAN, connect to:

```
Host:     <your-server-LAN-IP>
Port:     5432
Database: crown_tracker
User:     crown
Password: (whatever you set in .env, default: crownpass)
```

Works with pgAdmin, DBeaver, TablePlus, or any PostgreSQL client.

---

## Resetting the database

```bash
docker compose down -v        # removes the pgdata volume — all data gone
docker compose up --build     # re-seeds from scratch
```

---

## Environment variables

| Variable           | Default       | Description                          |
|--------------------|---------------|--------------------------------------|
| `POSTGRES_USER`    | `crown`       | Postgres username                    |
| `POSTGRES_PASSWORD`| `crownpass`   | Postgres password — change this      |
| `POSTGRES_DB`      | `crown_tracker` | Database name                      |
| `APP_PORT`         | `3000`        | Host port for the Next.js app        |

`DATABASE_URL` and `NEXT_PUBLIC_USE_DB=true` are set automatically by `docker-compose.yml` — you do not need to set them manually.
