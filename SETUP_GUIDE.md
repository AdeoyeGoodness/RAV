# RAV Setup Guide - Current Status

## ✅ Completed Steps

### Step 1: Infrastructure Services ✅
Docker services are running:
- ✅ PostgreSQL (port 5432)
- ✅ MinIO (ports 9000, 9001)
- ✅ Redis (port 6379)

### Step 2: Environment Configuration ✅
Environment variables can be set as needed (defaults work for development).

### Step 3: Database Initialization ✅
Database migrations have been run successfully:
- ✅ `agents` table created
- ✅ `events` table created
- ✅ Indexes and triggers configured

---

## 🔄 Next Steps

### Step 4: Install Rust (Required for Backend & Agent)

**Windows Installation:**

1. **Download and install Rust:**
   - Visit: https://rustup.rs/
   - Download `rustup-init.exe`
   - Run the installer
   - Choose "1) Proceed with installation (default)"

2. **Restart your terminal/PowerShell** after installation

3. **Verify installation:**
   ```powershell
   rustc --version
   cargo --version
   ```

   You should see version numbers for both.

### Step 5: Build and Run Backend

Once Rust is installed:

```powershell
cd backend
cargo build
cargo run
```

The backend will:
- Connect to PostgreSQL
- Run migrations automatically (already done, but it will verify)
- Start on http://localhost:8080

**Expected output:**
```
RAV Backend starting...
Configuration loaded
Database initialized
Database migrations completed
Server listening on 0.0.0.0:8080
```

### Step 6: Run Dashboard

In a **new terminal window**:

```powershell
cd dashboard
npm install
npm run dev
```

The dashboard will start on http://localhost:3000

**Expected output:**
```
▲ Next.js 14.x.x
- Local:        http://localhost:3000
```

### Step 7: View the Application

Open your browser and navigate to:
- **Dashboard**: http://localhost:3000
- **Backend API**: http://localhost:8080/health
- **MinIO Console**: http://localhost:9001 (login: minioadmin/minioadmin)

---

## 🧪 Testing the System

### Test Backend API:

```powershell
# Health check
curl http://localhost:8080/health

# Should return: 200 OK
```

### Send Test Event:

```powershell
curl -X POST http://localhost:8080/api/v1/events `
  -H "Content-Type: application/json" `
  -d '[{
    "event_type": "usb_inserted",
    "timestamp": "2024-01-01T12:00:00Z",
    "agent_id": "test-agent-1",
    "metadata": {"device_id": "USB123", "platform": "windows"}
  }]'
```

Then refresh the dashboard to see the event!

---

## 🐛 Troubleshooting

### Backend won't start:
- Ensure Rust is installed: `cargo --version`
- Check Docker is running: `docker-compose ps`
- Verify database connection in backend logs

### Dashboard shows no data:
- Verify backend is running: http://localhost:8080/health
- Check browser console (F12) for errors
- Ensure backend URL is correct in dashboard

### Port already in use:
- Backend (8080): Change `BACKEND_PORT` in environment
- Dashboard (3000): Change port in `dashboard/package.json` scripts
- PostgreSQL (5432): Change in `docker-compose.yml`

---

## 📝 Quick Reference

**All Services Running:**
```powershell
# Terminal 1: Infrastructure (already running)
docker-compose up -d

# Terminal 2: Backend
cd backend
cargo run

# Terminal 3: Dashboard
cd dashboard
npm run dev
```

**URLs:**
- Dashboard: http://localhost:3000
- Backend: http://localhost:8080
- MinIO: http://localhost:9001

**Stop Everything:**
```powershell
# Stop backend/dashboard (Ctrl+C in their terminals)
# Stop Docker services
docker-compose down
```

