import axios from 'axios'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export interface Event {
  id: string
  agent_id: string
  event_type: string
  timestamp: string
  metadata: any
  created_at: string
}

export interface Agent {
  id: string
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
}): Promise<void> {
  await api.post('/api/v1/agents/register', agent)
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

