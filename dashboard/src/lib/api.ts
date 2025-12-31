import axios from 'axios'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.55.213:8080'

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
  updated_at: string
}

export interface User {
  id: string
  organization_id: string | null
  email: string
  role: string
  full_name: string | null
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
  last_seen: string
  last_seen_ms: number
  token_expiry: string | null
  created_at: string
  updated_at: string
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
  const response = await api.get('/api/v1/events', { params })
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

export async function createOrganization(org: { name: string, enrollment_token: string, max_agents?: number, token_expiry?: string }): Promise<Organization> {
  const response = await api.post('/api/v1/admin/organizations', org)
  return response.data
}

export async function updateOrganizationStatus(orgId: string, status: string): Promise<void> {
  await api.patch(`/api/v1/admin/organizations/${orgId}/status`, { status })
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

