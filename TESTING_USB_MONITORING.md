# Testing USB Monitoring - Step-by-Step Guide

## Prerequisites

Before testing, ensure you have:

1. **Backend running** (on port 8080)
2. **Database running** (Docker PostgreSQL on port 5434)
3. **Agent compiled** (release build)

---

## Step 1: Start the Backend

Open a **PowerShell terminal** and run:

```powershell
cd C:\Users\BamBam\Desktop\RAV\backend
cargo run
```

You should see:
```
INFO rav_backend: RAV Backend starting...
INFO rav_backend: Database initialized
INFO rav_backend: Server listening on 0.0.0.0:8080
```

**Keep this terminal running!**

---

## Step 2: Verify Database is Running

In a **new PowerShell terminal**, check if Docker containers are running:

```powershell
docker ps
```

You should see `rav-postgres` container running. If not, start it:

```powershell
cd C:\Users\BamBam\Desktop\RAV
docker-compose up -d
```

---

## Step 3: Configure the Agent

The agent needs to know where the backend is. Create or check the agent config:

**Option A: Use Environment Variable (Easiest)**

In a **new PowerShell terminal**, set the backend URL:

```powershell
$env:BACKEND_URL="http://localhost:8080"
```

**Option B: Create Config File**

The agent will auto-create a config file, but you can verify it exists at:
- Windows: `C:\ProgramData\RAV\config.toml`

---

## Step 4: Run the Agent

In the same terminal where you set `BACKEND_URL`, run:

```powershell
cd C:\Users\BamBam\Desktop\RAV\agent
.\target\release\rav-agent.exe
```

You should see output like:
```
INFO rav_agent: RAV Agent starting...
INFO rav_agent: Configuration loaded
INFO rav_agent: Encryption initialized
INFO rav_agent: Sync manager initialized
INFO rav_agent: Monitoring modules started
INFO rav_agent: RAV Agent running in background. Press Ctrl+C to stop.
```

**Keep this terminal running!**

---

## Step 5: Test USB Monitoring

### Test 1: Plug in a USB Device

1. **Plug in any USB device** (flash drive, mouse, keyboard, phone, etc.)
2. **Wait 5-10 seconds** (the agent checks every 5 seconds)
3. Check the agent terminal - you should see:
   ```
   INFO rav_agent::monitoring::usb: USB device inserted: USB\VID_XXXX&PID_XXXX\...
   ```

### Test 2: Unplug the USB Device

1. **Unplug the USB device**
2. **Wait 5-10 seconds**
3. Check the agent terminal - you should see:
   ```
   INFO rav_agent::monitoring::usb: USB device removed: USB\VID_XXXX&PID_XXXX\...
   ```

### Test 3: Multiple Devices

1. **Plug in multiple USB devices** (one at a time or all at once)
2. **Unplug them** (one at a time)
3. Watch the agent terminal for multiple insertion/removal events

---

## Step 6: Verify Events in Backend

### Option A: Check Backend Logs

Look at the backend terminal - you should see:
```
INFO rav_backend: Received events batch: 1 events
```

### Option B: Check Database Directly

In a **new PowerShell terminal**:

```powershell
docker exec -it rav-postgres psql -U rav_user -d rav_db -c "SELECT event_type, agent_id, timestamp, metadata FROM events ORDER BY timestamp DESC LIMIT 10;"
```

You should see rows like:
```
   event_type   | agent_id |          timestamp           |                    metadata
----------------+----------+-----------------------------+------------------------------------------
 usb_inserted   | agent-1  | 2025-01-XX XX:XX:XX.XXX+00  | {"device_id":"USB\\...","platform":"windows"}
 usb_removed    | agent-1  | 2025-01-XX XX:XX:XX.XXX+00  | {"device_id":"USB\\...","platform":"windows"}
```

---

## Step 7: View Events in Dashboard

### Start the Dashboard

In a **new PowerShell terminal**:

```powershell
cd C:\Users\BamBam\Desktop\RAV\dashboard
npm run dev
```

### View Events

1. Open your browser: **http://localhost:3000**
2. Look at the **"Recent Events"** section (top left)
3. You should see USB insertion/removal events appearing in real-time
4. Events refresh every 30 seconds automatically

---

## Troubleshooting

### Problem: Agent doesn't detect USB devices

**Solution 1: Check USB monitoring is enabled**
- The agent enables USB monitoring by default
- Check logs for: `INFO rav_agent::monitoring::usb: Starting USB monitoring`

**Solution 2: Check PowerShell permissions**
- The agent uses PowerShell to detect USB devices
- Make sure PowerShell execution policy allows scripts:
  ```powershell
  Get-ExecutionPolicy
  # If it says "Restricted", run:
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

**Solution 3: Run agent with verbose logging**
```powershell
$env:RUST_LOG="rav_agent=debug"
.\target\release\rav-agent.exe
```

### Problem: Events not reaching backend

**Solution 1: Check backend URL**
- Verify `BACKEND_URL` is set correctly
- Default is `http://localhost:8080`

**Solution 2: Check backend is running**
- Make sure backend terminal shows: `Server listening on 0.0.0.0:8080`
- Test with: `curl http://localhost:8080/api/v1/agents`

**Solution 3: Check agent sync logs**
- Look for: `INFO rav_agent::sync: Syncing events to backend`
- Look for errors: `ERROR rav_agent::sync: Failed to sync events`

### Problem: No events in dashboard

**Solution 1: Check dashboard is connected**
- Open browser console (F12)
- Look for API errors

**Solution 2: Check events exist in database**
- Use the database query from Step 6

**Solution 3: Refresh dashboard**
- Dashboard polls every 30 seconds
- Wait or refresh the page

---

## Expected Behavior

### Normal Operation

1. **Agent starts** → Logs initialization messages
2. **USB device plugged** → Agent detects within 5 seconds
3. **Event queued** → Agent logs "USB device inserted"
4. **Event synced** → Agent sends to backend (within 30 seconds)
5. **Backend stores** → Backend logs "Received events batch"
6. **Dashboard shows** → Event appears in "Recent Events" section

### Event Flow

```
USB Device → Agent Detection → Event Queue → Backend API → Database → Dashboard
   (5 sec)      (instant)        (30 sec)      (instant)    (30 sec)
```

---

## Advanced Testing

### Test with Different USB Devices

Try plugging in:
- USB flash drives
- USB mice/keyboards
- USB phones/tablets
- USB external hard drives
- USB hubs

### Test Rapid Insertion/Removal

1. Plug and unplug a USB device **rapidly** (multiple times)
2. Verify all events are captured
3. Check that no events are lost

### Test Multiple Agents

1. Run multiple agent instances (on different machines or with different agent IDs)
2. Verify events are tagged with correct `agent_id`
3. Check dashboard shows events from all agents

---

## Success Criteria

✅ Agent detects USB insertion within 5 seconds  
✅ Agent detects USB removal within 5 seconds  
✅ Events appear in backend logs  
✅ Events stored in database  
✅ Events visible in dashboard  
✅ Event metadata includes device_id and platform  

---

## Next Steps

Once USB monitoring is working:

1. Test **Network Monitoring** (similar process)
2. Test **Dashboard filtering** (filter by agent_id, event_type)
3. Test **Real-time updates** (watch dashboard while plugging/unplugging)
4. Move to **Phase 2** features (screenshots, browser history)

