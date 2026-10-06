'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Download, FileText, Calendar, HardDrive, User, File, Trash2, AlertTriangle } from 'lucide-react'
import { getEvents, deleteAgentEvents } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import NextArchiveBanner from '@/components/NextArchiveBanner'
import { useAuth } from '@/contexts/AuthContext'
import { formatWATPattern } from '@/lib/time'
import { Panel, PanelHead, SectionHead, Eyebrow, ActionButton, StatusPill } from '@/components/ct/primitives'

interface Document {
  id: string
  event_type: string
  timestamp: string
  agent_id: string
  metadata: {
    file_name?: string
    file_path?: string
    file_size?: number
    direction?: string
    device_id?: string
    device_name?: string
    platform?: string
    backup_file_id?: string
    drive_letter?: string
  }
}

export default function DocumentsPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileId = searchParams.get('id')

  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearTimestamp, setClearTimestamp] = useState<Date | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (user) {
      loadDocuments()
    }
  }, [user])

  useEffect(() => {
    if (fileId && documents.length > 0) {
      const doc = documents.find(d => d.id === fileId)
      if (doc) {
        setSelectedDocument(doc)
      }
    }
  }, [fileId, documents])

  const loadDocuments = async () => {
    setLoading(true)
    try {
      const events = await getEvents({ event_type: 'usb_file_transfer', limit: 1000 })
      const docs = events.map(event => ({
        id: event.id,
        event_type: event.event_type,
        timestamp: event.timestamp,
        agent_id: event.agent_id,
        metadata: event.metadata || {},
      }))

      // Filter documents to only show those after clear timestamp
      const filteredDocs = clearTimestamp
        ? docs.filter(doc => new Date(doc.timestamp) > clearTimestamp)
        : docs

      setDocuments(filteredDocs)

      // If fileId is provided, select that document
      if (fileId) {
        const doc = filteredDocs.find(d => d.id === fileId)
        if (doc) {
          setSelectedDocument(doc)
        }
      }
    } catch (error) {
      console.error('Failed to load documents:', error)
    } finally {
      setLoading(false)
    }
  }

  const clearDocuments = () => {
    if (confirm('Clear all displayed documents? Only NEW documents after this point will be shown. Old data will be hidden.')) {
      setClearTimestamp(new Date())
      setDocuments([])
      setSelectedDocument(null)
    }
  }

  const handleDeleteAllDocuments = async () => {
    // Get unique agent IDs from documents
    const agentIds = [...new Set(documents.map(d => d.agent_id))]

    if (agentIds.length === 0) {
      alert('No documents to delete')
      return
    }

    const agentList = agentIds.length === 1
      ? `device "${agentIds[0]}"`
      : `${agentIds.length} devices`

    if (!confirm(`WARNING: This will PERMANENTLY DELETE ALL ${documents.length} document events from the backend database for ${agentList}.\n\nThis action cannot be undone. Are you absolutely sure?`)) {
      return
    }

    if (!confirm(`Final confirmation: Delete ALL ${documents.length} document events?`)) {
      return
    }

    setDeleting(true)
    try {
      let totalDeleted = 0
      for (const agentId of agentIds) {
        const result = await deleteAgentEvents(agentId)
        totalDeleted += result.deleted_count
      }
      alert(`Successfully deleted ${totalDeleted} document events`)
      // Clear and reload
      setDocuments([])
      setSelectedDocument(null)
      setClearTimestamp(null)
      loadDocuments()
    } catch (error: any) {
      console.error('Failed to delete documents:', error)
      alert(`Failed to delete documents: ${error.message || 'Unknown error'}`)
    } finally {
      setDeleting(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const formatDate = (timestamp: string) => formatWATPattern(timestamp, 'MMMM d, yyyy HH:mm:ss')

  const [downloadError, setDownloadError] = useState<string | null>(null)

  const handleDownload = async (doc: Document) => {
    try {
      setDownloadError(null)

      const metadata = doc.metadata
      const fileName = metadata.file_name || 'document'
      const backupFileId = metadata.backup_file_id

      // Try to download the actual file from backend if it was backed up
      if (backupFileId) {
        try {
          const { downloadFile } = await import('@/lib/api')
          const fileBlob = await downloadFile(backupFileId)

          // Create download link
          const url = URL.createObjectURL(fileBlob)
          const link = window.document.createElement('a')
          link.href = url
          link.download = fileName
          window.document.body.appendChild(link)
          link.click()
          window.document.body.removeChild(link)
          URL.revokeObjectURL(url)

          return // Successfully downloaded actual file
        } catch (fileError: any) {
          console.error('Failed to download file from backend:', fileError)
          setDownloadError('File backup not available. Downloading metadata instead.')
          // Fall through to metadata download
        }
      }

      // Fallback: Download metadata file
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 50)

      const content = `RAV Document Information
=======================

File Name: ${metadata.file_name || 'Unknown'}
File Path: ${metadata.file_path || 'Unknown'}
File Size: ${metadata.file_size ? formatFileSize(metadata.file_size) : 'Unknown'}
Direction: ${metadata.direction === 'to_usb' ? 'Copied TO USB' : 'Copied FROM USB'}
Device: ${metadata.device_name || metadata.device_id || 'Unknown'}
Drive Letter: ${metadata.drive_letter || 'N/A'}
Platform: ${metadata.platform || 'Unknown'}
Timestamp: ${formatDate(doc.timestamp)}
Agent ID: ${doc.agent_id}
Event ID: ${doc.id}
${backupFileId ? `Backup File ID: ${backupFileId}\nFile was backed up and can be downloaded.` : 'Note: File was not backed up (may be too large or from USB removal).'}
`

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${safeFileName}_metadata.txt`
      window.document.body.appendChild(link)
      link.click()
      window.document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      console.error('Download error:', error)
      setDownloadError(error.message || 'Failed to download file. Please try again.')
      setTimeout(() => setDownloadError(null), 5000)
    }
  }

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-ct-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full animate-spin" style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }} />
          <span className="text-[10px] font-mono uppercase text-ct-ink3" style={{ letterSpacing: '0.24em' }}>Loading documents</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />
        <NextArchiveBanner />
        <main className="flex-1 overflow-auto p-8 mt-20 space-y-6">
          <SectionHead
            eyebrow="Fleet / Documents"
            title="Documents"
            right={
              <div className="flex items-center gap-2">
                <ActionButton onClick={() => router.back()} variant="ghost">
                  <span className="inline-flex items-center gap-2">
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </span>
                </ActionButton>
                <ActionButton
                  onClick={handleDeleteAllDocuments}
                  disabled={loading || deleting || documents.length === 0}
                  variant="danger"
                >
                  <span className="inline-flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3" />
                    {deleting ? 'Deleting…' : 'Delete All'}
                  </span>
                </ActionButton>
                <ActionButton onClick={clearDocuments} disabled={loading || documents.length === 0} variant="ghost">
                  <span className="inline-flex items-center gap-2">
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </span>
                </ActionButton>
                <ActionButton onClick={loadDocuments} disabled={loading} variant="primary">
                  {loading ? 'Refreshing…' : 'Refresh'}
                </ActionButton>
              </div>
            }
          />
          <p className="text-ct-ink3 text-[13px] -mt-2 max-w-3xl">
            Tracked files from USB transfers.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Documents List */}
            <div className="lg:col-span-1">
              <Panel>
                <PanelHead title="Tracked Files" meta={`${documents.length} records`} />
                <div className="p-4 space-y-2 max-h-[600px] overflow-y-auto">
                  {loading ? (
                    <div className="flex items-center gap-2 py-2">
                      <div className="w-4 h-4 rounded-full animate-spin" style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }} />
                      <p className="text-[11px] text-ct-ink3 font-mono uppercase" style={{ letterSpacing: '0.18em' }}>Loading</p>
                    </div>
                  ) : documents.length === 0 ? (
                    <div className="py-8 text-center">
                      <FileText className="w-7 h-7 mx-auto mb-2 text-ct-ink4" />
                      <p className="text-[12px] text-ct-ink3 mb-1">No documents tracked</p>
                      <p className="text-[10px] text-ct-ink4">USB file transfers will appear here when detected by the agent</p>
                    </div>
                  ) : (
                    documents.map((doc) => {
                      const isActive = selectedDocument?.id === doc.id
                      return (
                        <button
                          key={doc.id}
                          onClick={() => {
                            setSelectedDocument(doc)
                            router.push(`/documents?id=${doc.id}`, { scroll: false })
                          }}
                          className="w-full text-left p-3 rounded-sm border transition-colors"
                          style={{
                            background: isActive ? 'var(--ct-accent-soft)' : 'var(--ct-bg2)',
                            borderColor: isActive ? 'var(--ct-accent-border)' : 'var(--ct-line)',
                          }}
                        >
                          <div className="flex items-start space-x-2">
                            <FileText className="w-4 h-4 mt-0.5 flex-shrink-0 text-ct-accent" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium truncate text-ct-ink">
                                {doc.metadata.file_name || 'Unknown File'}
                              </p>
                              <p className="text-[11px] mt-1 text-ct-ink3 font-mono tabular-nums">
                                {doc.metadata.file_size ? formatFileSize(doc.metadata.file_size) : 'Unknown size'}
                              </p>
                            </div>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </Panel>
            </div>

            {/* Document Details */}
            <div className="lg:col-span-2">
              {selectedDocument ? (
                <Panel>
                  <PanelHead
                    title={selectedDocument.metadata.file_name || 'Unknown File'}
                    meta={selectedDocument.metadata.file_path || 'Path not available'}
                    right={
                      <div className="flex items-center gap-2">
                        <ActionButton
                          onClick={() => {
                            const filePath = selectedDocument.metadata?.file_path
                            const driveLetter = selectedDocument.metadata?.drive_letter
                            if (filePath) {
                              const isUSBDrive = driveLetter && filePath.startsWith(driveLetter)
                              navigator.clipboard.writeText(filePath).then(() => {
                                const message = isUSBDrive
                                  ? `USB Drive File Access\n\nPath: ${filePath}\n\nEnsure the USB drive (${driveLetter}) is still connected. The path has been copied to your clipboard.`
                                  : `File Path Copied.\n\nPath: ${filePath}\n\nOpen File Explorer, paste and press Enter.`
                                alert(message)
                              }).catch(() => {
                                alert(`File Path: ${filePath}`)
                              })
                            }
                          }}
                          variant="ghost"
                        >
                          <span className="inline-flex items-center gap-2">
                            <FileText className="w-3 h-3" />
                            Open Location
                          </span>
                        </ActionButton>
                        <ActionButton onClick={() => handleDownload(selectedDocument)} variant="primary">
                          <span className="inline-flex items-center gap-2">
                            <Download className="w-3 h-3" />
                            {selectedDocument.metadata?.backup_file_id ? 'Download File' : 'Download Info'}
                          </span>
                        </ActionButton>
                      </div>
                    }
                  />
                  <div className="p-6 space-y-5">
                    {selectedDocument.metadata?.backup_file_id && (
                      <StatusPill tone="ok">File backed up</StatusPill>
                    )}
                    {downloadError && (
                      <div
                        className="text-[12px] px-3 py-2 rounded-sm border"
                        style={{ background: 'var(--ct-crit-soft)', borderColor: 'var(--ct-crit-border)', color: 'var(--ct-crit)' }}
                      >
                        {downloadError}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 rounded-sm border border-ct-line bg-ct-bg2">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-3.5 h-3.5 text-ct-accent" />
                          <Eyebrow>File Size</Eyebrow>
                        </div>
                        <p className="text-[15px] font-mono tabular-nums text-ct-ink">
                          {selectedDocument.metadata.file_size ? formatFileSize(selectedDocument.metadata.file_size) : 'Unknown'}
                        </p>
                      </div>

                      <div className="p-4 rounded-sm border border-ct-line bg-ct-bg2">
                        <div className="flex items-center gap-2 mb-2">
                          {selectedDocument.metadata.direction === 'to_usb'
                            ? <Download className="w-3.5 h-3.5 text-ct-accent" />
                            : <File className="w-3.5 h-3.5 text-ct-accent" />}
                          <Eyebrow>Direction</Eyebrow>
                        </div>
                        <p className="text-[15px] font-medium text-ct-ink">
                          {selectedDocument.metadata.direction === 'to_usb'
                            ? 'Copied TO USB'
                            : 'Copied FROM USB'}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-sm border border-ct-line bg-ct-bg2">
                      <Eyebrow className="mb-4">Details</Eyebrow>
                      <div className="space-y-3">
                        {[
                          { icon: Calendar, label: 'Timestamp', value: formatDate(selectedDocument.timestamp) },
                          { icon: HardDrive, label: 'Device', value: selectedDocument.metadata.device_name || selectedDocument.metadata.device_id || 'Unknown' },
                          { icon: User, label: 'Agent ID', value: selectedDocument.agent_id, mono: true },
                          { icon: File, label: 'Platform', value: selectedDocument.metadata.platform || 'Unknown' },
                        ].map(row => (
                          <div key={row.label} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <row.icon className="w-3.5 h-3.5 text-ct-ink3" />
                              <span className="text-[12px] text-ct-ink3">{row.label}</span>
                            </div>
                            <span className={`text-[12px] text-ct-ink ${row.mono ? 'font-mono tabular-nums' : ''}`}>
                              {row.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {selectedDocument.metadata.file_path && (
                      <div className="p-4 rounded-sm border border-ct-line bg-ct-bg2">
                        <div className="flex items-center justify-between mb-2">
                          <Eyebrow>Full Path</Eyebrow>
                          {selectedDocument.metadata.drive_letter && (
                            <StatusPill tone="warn">USB Drive</StatusPill>
                          )}
                        </div>
                        <p className="text-[12px] font-mono break-all mb-2 text-ct-ink2">
                          {selectedDocument.metadata.file_path}
                        </p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(selectedDocument.metadata.file_path || '').then(() => {
                              alert('Path copied to clipboard.')
                            })
                          }}
                          className="text-[11px] font-mono uppercase text-ct-accent hover:brightness-125"
                          style={{ letterSpacing: '0.18em' }}
                        >
                          Copy Path
                        </button>
                      </div>
                    )}
                  </div>
                </Panel>
              ) : (
                <Panel>
                  <div className="p-10 text-center">
                    <div className="w-11 h-11 mx-auto mb-3 rounded-sm border border-ct-line bg-ct-bg2 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-ct-ink4" />
                    </div>
                    <p className="text-[13px] font-medium mb-1 text-ct-ink2">No document selected</p>
                    <p className="text-[11px] text-ct-ink3">
                      Select a tracked file from the sidebar to view transfer details, metadata, and download options.
                    </p>
                  </div>
                </Panel>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
