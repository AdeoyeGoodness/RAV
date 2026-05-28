import axios from 'axios'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://rav.handy.boats'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true // Important for HttpOnly Cookies
})

// Internal authority state (not persistent in localStorage)
let internalRole: string | null = null
let internalOrgId: string | null = null

/**
 * Enterprise-Grade Authority Sync
 * Called by AuthContext to inject verified JWT claims into the API layer.
 */
export function setApiAuthority(role: string | null, orgId: string | null) {
  internalRole = role
  internalOrgId = orgId
}

api.interceptors.request.use((config) => {
  // 1. Role-Gating Firewall
  // Block restricted API calls BEFORE they leave the browser if role is insufficient.
  if (config.url?.includes('/api/v1/admin/')) {
    if (internalRole !== 'super_admin') {
      console.error(`🛡️ [API Firewall] Blocked unauthorized ${config.method?.toUpperCase()} to ${config.url}. Expected: super_admin, Actual: ${internalRole}`)
      return Promise.reject(new Error('Unauthorized: Role insufficient for platform administration'))
    }
  }

  // 2. Organization Context Gating
  // ONLY attach X-Organization-Id if user is a verified super_admin.
  // This prevents org_admin users from inadvertently overriding their JWT scope.
  if (internalRole === 'super_admin' && internalOrgId) {
    config.headers['X-Organization-Id'] = internalOrgId
  }

  return config
})

export interface Organization {
  id: string
  name: string
  enrollment_token: string
  status: string
  max_agents: number
  token_expiry: string | null
  created_at: string
  created_at_ms: number
  updated_at: string
  admin_verified?: boolean
}

export interface User {
  id: string
  organization_id: string | null
  email: string
  role: 'super_admin' | 'org_admin' | 'user'
  status: 'active' | 'suspended'
  must_change_password?: boolean
}

export interface Archive {
  id: string
  organization_id: string
  agent_id: string
  filename: string
  size_bytes: number
  event_count: number
  start_date: string
  end_date: string
  created_at: string
}


export interface Event {
  id: string
  organization_id: string
  agent_id: string
  event_type: string
  timestamp: string
  metadata: any
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: 'system' | 'user' | 'process' | 'network' | 'file' | 'security'
  created_at: string
}

export interface Agent {
  id: string
  organization_id: string
  agent_id: string
  hardware_fingerprint: string
  hostname: string | null
  display_name?: string | null // Editable friendly label; agent_id stays immutable
  last_seen: string
  last_seen_ms: number
  server_time_ms: number // For drift-proof status
  token_expiry: string | null
  created_at: string
  updated_at: string
  admin_verified?: boolean
  enrollment_token_id?: string | null
  campaign?: string | null // Enrollment-token label this device registered under
  // Health signals from the endpoint-side Scheduled Task and the main agent's
  // lifecycle events. Used by deriveDeviceStatus() to tell "stopped" from
  // "killed" from "removed" from "offline-unknown" when last_seen is stale.
  watchdog_last_seen?: string | null
  watchdog_service_state?: string | null  // Running | Stopped | NotInstalled | Unknown
  watchdog_binary_present?: boolean | null
  watchdog_version?: string | null
  last_lifecycle_state?: string | null    // started | stopping | uninstalling
  last_lifecycle_at?: string | null
}

/** What the dashboard should show for a device, derived from heartbeat +
 *  watchdog + lifecycle. Kept here (next to the type) so any view can call it. */
export type DeviceStatus =
  | { kind: 'online' }
  | { kind: 'stopped'; detail: string }      // graceful (admin) stop
  | { kind: 'killed'; detail: string }       // service Stopped without a 'stopping' event
  | { kind: 'removed'; detail: string }      // binary or service gone
  | { kind: 'tampered'; detail: string }     // inconsistent state (service gone, binary still there)
  | { kind: 'offline_unknown'; detail: string } // neither agent nor watchdog reporting

export function deriveDeviceStatus(a: Agent, now: number = Date.now()): DeviceStatus {
  const ageMs = (ts: string | null | undefined) =>
    ts ? Math.max(0, now - new Date(ts).getTime()) : Number.POSITIVE_INFINITY
  const heartbeatStale = ageMs(a.last_seen) > 3 * 60 * 1000        // > 3 min
  const watchdogFresh  = ageMs(a.watchdog_last_seen) < 15 * 60 * 1000 // < 15 min
  const lifecycleFresh = ageMs(a.last_lifecycle_at) < 30 * 60 * 1000  // < 30 min

  if (!heartbeatStale) return { kind: 'online' }

  if (lifecycleFresh && (a.last_lifecycle_state === 'stopping' || a.last_lifecycle_state === 'uninstalling')) {
    return { kind: 'stopped', detail: `graceful (${a.last_lifecycle_state})` }
  }

  if (watchdogFresh) {
    const svc = a.watchdog_service_state
    const bin = a.watchdog_binary_present
    if (svc === 'NotInstalled' && bin === false) return { kind: 'removed', detail: 'uninstalled' }
    if (svc === 'NotInstalled' && bin === true)  return { kind: 'tampered', detail: 'service gone, binary present' }
    if (svc === 'Stopped' && bin)                return { kind: 'killed', detail: 'service stopped (no graceful event)' }
    if (svc === 'Running')                       return { kind: 'online' } // watchdog says it's running; heartbeat may be lagging
  }

  return { kind: 'offline_unknown', detail: 'no heartbeat or watchdog' }
}

// Set or clear the human-readable label shown for a device. Pass null/empty to clear back
// to "use hostname". agent_id is never changed — this is a pure relabel.
export async function updateAgentDisplayName(agentId: string, displayName: string | null): Promise<void> {
  await api.patch(`/api/v1/agents/${agentId}/display-name`, { display_name: displayName })
}

export async function getEvents(params?: {
  agent_id?: string
  event_type?: string
  category?: string
  severity?: string
  start_time?: string
  end_time?: string
  limit?: number
}): Promise<Event[]> {
  // Default to "last 24h" so dashboard views don't silently miss older events when the
  // backend's hard cap (1000) is hit by a busy stream — the cause of the 2026-05-28
  // "where did this morning's events go?" report. Callers that need longer history pass
  // an explicit start_time (or end_time, in which case we leave the range alone).
  const defaultStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const queryParams = {
    ...params,
    start_time: params?.start_time || (params?.end_time ? undefined : defaultStart),
    // Match the backend cap; asking for more is wasted bandwidth.
    limit: Math.min(params?.limit ?? 1000, 1000),
  }
  const response = await api.get('/api/v1/events', { params: queryParams })
  return response.data
}

export async function getAgents(): Promise<Agent[]> {
  const response = await api.get('/api/v1/agents')
  return response.data
}

export async function enrollAgent(agent: {
  agent_id: string
  hardware_fingerprint: string
  enrollment_token: string
}): Promise<void> {
  await api.post('/api/v1/agents/enroll', agent)
}
// ...
export async function getPlatformStats(): Promise<{
  total_organizations: number,
  total_agents: number,
  active_last_24h: number
}> {
  const response = await api.get('/api/v1/admin/stats');
  return response.data;
}

export async function getOrgStats(): Promise<{
  total_agents: number,
  active_last_24h: number
}> {
  const response = await api.get('/api/v1/org/stats');
  return response.data;
}

export async function getSystemHealth(): Promise<{
  status: string,
  uptime_seconds: number,
  cpu_load: number,
  database_connected: boolean,
  orchestrator_version: string
}> {
  const response = await api.get('/api/v1/admin/health');
  return response.data;
}

export async function sendHeartbeat(heartbeat: {
  agent_id: string
  hardware_fingerprint: string
  timestamp: string
  version: string
}): Promise<void> {
  await api.post('/api/v1/agents/heartbeat', heartbeat)
}

export async function downloadFile(fileId: string): Promise<Blob> {
  const response = await api.get(`/api/v1/files/${fileId}`, {
    responseType: 'blob',
  })
  return response.data
}

export async function deleteAgentEvents(agentId: string): Promise<{ status: string; message: string; deleted_count: number }> {
  const response = await api.delete(`/api/v1/agents/${agentId}/events`)
  return response.data
}

export async function deleteAgent(agentId: string): Promise<{ status: string; message: string; agent_deleted: boolean; events_deleted: number }> {
  const response = await api.delete(`/api/v1/agents/${agentId}`)
  return response.data
}

export async function restoreAgentEvents(agentId: string): Promise<{ status: string; message: string; restored_count: number }> {
  const response = await api.put(`/api/v1/agents/${agentId}/events/restore`)
  return response.data
}

// Admin APIs
export async function getOrganizations(): Promise<Organization[]> {
  const response = await api.get('/api/v1/admin/organizations')
  return response.data;
}

export async function getOrgDetails(): Promise<Organization> {
  const response = await api.get('/api/v1/org/me')
  return response.data
}

export async function createOrganization(org: { name: string, admin_email: string, max_agents?: number, token_expiry?: string | null }): Promise<{ organization: Organization, admin_email: string, temporary_password: string }> {
  const response = await api.post('/api/v1/admin/organizations', org)
  return response.data
}

export async function updateOrganizationStatus(orgId: string, status: string): Promise<void> {
  await api.patch(`/api/v1/admin/organizations/${orgId}/status`, { status })
}

export interface EnrollmentToken {
  token_id: string
  org_id: string
  label: string | null
  max_agents: number | null
  expires_at: string | null
  revoked: boolean
  created_at: string
  agent_count: number // agents currently enrolled under this token
}

export interface EnrollmentTokenResponse {
  token_id: string
  raw_token: string | null
  label: string | null
  max_agents: number | null
  expires_at: string | null
}

export async function getEnrollmentTokens(): Promise<EnrollmentToken[]> {
  const response = await api.get('/api/v1/org/enrollment-tokens')
  return response.data
}

export async function createEnrollmentToken(data: { label?: string, max_agents?: number, expires_at?: string }): Promise<EnrollmentTokenResponse> {
  const response = await api.post('/api/v1/org/enrollment-tokens', data)
  return response.data
}

export async function revokeEnrollmentToken(tokenId: string): Promise<void> {
  await api.delete(`/api/v1/org/enrollment-tokens/${tokenId}`)
}

export async function updateOrganization(orgId: string, org: { name?: string, max_agents?: number, token_expiry?: string, status?: string }): Promise<Organization> {
  const response = await api.patch(`/api/v1/admin/organizations/${orgId}`, org)
  return response.data
}

export async function deleteOrganization(orgId: string): Promise<void> {
  await api.delete(`/api/v1/admin/organizations/${orgId}`)
}

export async function restoreOrganizationData(orgId: string): Promise<{ restored: { agents: number, events: number, files: number } }> {
  const response = await api.post(`/api/v1/admin/organizations/${orgId}/restore`)
  return response.data
}

export interface AuditLog {
  id: string
  timestamp: string
  actor_type: 'super_admin' | 'org_admin' | 'system'
  actor_id: string | null
  organization_id: string | null
  action_type: string
  target_type: string
  target_id: string | null
  metadata: any
  ip_address: string | null
  user_agent: string | null
  actor_email: string | null
  actor_name: string | null
}

export async function getAuditLogs(params?: {
  organization_id?: string
  actor_type?: string
  action_type?: string
  target_type?: string
  start_time?: string
  end_time?: string
  limit?: number
  offset?: number
}): Promise<AuditLog[]> {
  const response = await api.get('/api/v1/admin/audits', { params })
  return response.data
}

export async function getOrgAuditLogs(params?: {
  actor_type?: string
  action_type?: string
  target_type?: string
  start_time?: string
  end_time?: string
  limit?: number
  offset?: number
}): Promise<AuditLog[]> {
  const response = await api.get('/api/v1/org/audits', { params })
  return response.data
}

// Auth APIs
export async function userLogout(): Promise<void> {
  await api.post('/api/v1/auth/logout')
}

export async function getCurrentUser(): Promise<User> {
  const response = await api.get('/api/v1/auth/me')
  return response.data
}

export async function login(credentials: any): Promise<{ token: string, user: User }> {
  const response = await api.post('/api/v1/auth/login', credentials)
  return response.data
}

export async function getArchives(agentId?: string): Promise<Archive[]> {
  const params = agentId ? { agent_id: agentId } : {}
  const response = await api.get('/api/v1/archives', { params })
  return response.data
}

export async function triggerManualArchive(agentId: string): Promise<any> {
  const response = await api.post(`/api/v1/agents/${agentId}/archive`)
  return response.data
}

export async function collateArchives(): Promise<any> {
  const response = await api.post('/api/v1/archives/collate')
  return response.data
}

export async function downloadArchive(archiveId: string, password: string): Promise<Blob> {
  const response = await api.post(`/api/v1/archives/${archiveId}/download`, { password }, {
    responseType: 'blob',
  })
  return response.data
}

export async function deleteArchive(archiveId: string): Promise<void> {
  await api.delete(`/api/v1/archives/${archiveId}`)
}

export async function register(userData: {
  organization_id: string | null,
  email: string,
  password: string,
  full_name: string,
  role: string
}): Promise<{ id: string }> {
  const response = await api.post('/api/v1/auth/register', userData)
  return response.data
}


export const changePassword = async (data: any) => {
  const response = await api.post('/api/v1/auth/change-password', data)
  return response.data
}
