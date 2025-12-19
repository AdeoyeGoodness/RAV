import axios from 'axios'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add auth and organization context from localStorage
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('rav_token')
    const orgId = localStorage.getItem('rav_organization_id')

    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }

    if (orgId) {
      config.headers['X-Organization-Id'] = orgId
    }
  }
  return config
})

export interface Organization {
  id: string
  name: string
  license_key: string
  status: string
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
  created_at: string
}

export interface Agent {
  id: string
  organization_id: string
  agent_id: string
  hardware_fingerprint: string
  last_seen: string
  license_expiry: string | null
  created_at: string
  updated_at: string
}

export async function getEvents(params?: {
  agent_id?: string
  event_type?: string
  limit?: number
}): Promise<Event[]> {
  const response = await api.get('/api/v1/events', { params })
  return response.data
}

export async function getAgents(): Promise<Agent[]> {
  const response = await api.get('/api/v1/agents')
  return response.data
}

export async function registerAgent(agent: {
  agent_id: string
  hardware_fingerprint: string
  license_key: string
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
  return response.data
}

export async function createOrganization(org: { name: string, license_key: string }): Promise<Organization> {
  const response = await api.post('/api/v1/admin/organizations', org)
  return response.data
}

export async function updateOrganizationStatus(orgId: string, status: string): Promise<void> {
  await api.patch(`/api/v1/admin/organizations/${orgId}/status`, { status })
}

// Auth APIs
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

