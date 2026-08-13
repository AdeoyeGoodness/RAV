'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Download, FileText, Calendar, HardDrive, User, File, Trash2, AlertTriangle } from 'lucide-react'
import { getEvents, deleteAgentEvents } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import { useAuth } from '@/contexts/AuthContext'
import { formatWATPattern } from '@/lib/time'

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

  const resetClearFilter = () => {
    setClearTimestamp(null)
    loadDocuments() // Reload to show all documents
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

    if (!confirm(`⚠️ WARNING: This will PERMANENTLY DELETE ALL ${documents.length} document events from the backend database for ${agentList}.\n\nThis action cannot be undone. Are you absolutely sure?`)) {
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
      alert(`✅ Successfully deleted ${totalDeleted} document events`)
      // Clear and reload
      setDocuments([])
      setSelectedDocument(null)
      setClearTimestamp(null)
      loadDocuments()
    } catch (error: any) {
      console.error('Failed to delete documents:', error)
      alert(`❌ Failed to delete documents: ${error.message || 'Unknown error'}`)
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

IMPORTANT NOTES:
================
1. This is metadata information about the file transfer event.
2. The actual file is located at: ${metadata.file_path || 'Unknown path'}
3. ${backupFileId ? 'A backup of this file is available and was attempted to download above.' : 'This file was not backed up. To access it:'}
   - If on USB drive: Ensure the USB device is still connected
   - If on system: Navigate to the file path shown above
   - Files may have been moved or deleted since the transfer was logged
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

  const getDirectionColor = (direction: string) => {
    return direction === 'to_usb'
      ? 'text-[#00D9FF] bg-[#00D9FF]/10 border-[#00D9FF]/30'
      : 'text-[#6C5CE7] bg-[#6C5CE7]/10 border-[#6C5CE7]/30'
  }

  const getDirectionIcon = (direction: string) => {
    return direction === 'to_usb'
      ? <Download className="w-4 h-4 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
      : <File className="w-4 h-4 transition-colors" style={{ color: 'var(--accent-purple)' }} />
  }

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-[#05050A] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-slate-700 border-t-slate-400 rounded-full animate-spin"></div>
          <p className="text-xs text-slate-600 font-mono">Loading documents...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen transition-colors" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar />
      <div className="flex-1 ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />
        <main className="pt-20 p-8 overflow-y-auto h-full">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => router.back()}
                  className="p-2 rounded-lg transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <ArrowLeft className="w-5 h-5 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
                </button>
                <div>
                  <h1 className="text-2xl font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>Documents</h1>
                  <p className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Tracked files from USB transfers</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleDeleteAllDocuments}
                  disabled={loading || deleting || documents.length === 0}
                  className="px-4 py-2 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 border"
                  style={{ backgroundColor: 'rgba(255, 107, 107, 0.2)', color: '#FF6B6B', borderColor: 'rgba(255, 107, 107, 0.3)' }}
                  onMouseEnter={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.3)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)'
                    }
                  }}
                  title="Delete all documents from backend (permanent)"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>{deleting ? 'Deleting...' : 'Delete All'}</span>
                </button>
                <button
                  onClick={clearDocuments}
                  disabled={loading || documents.length === 0}
                  className="px-4 py-2 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: '#FF6B6B' }}
                  onMouseEnter={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'
                    }
                  }}
                  title="Clear displayed documents (frontend only)"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Clear</span>
                </button>
                <button
                  onClick={loadDocuments}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg transition-all disabled:opacity-50 flex items-center space-x-2"
                  style={{ backgroundColor: 'rgba(0, 217, 255, 0.2)', color: 'var(--accent-cyan)' }}
                  onMouseEnter={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.3)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.2)'
                    }
                  }}
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin transition-colors" style={{ borderColor: 'var(--accent-cyan)' }} />
                      <span>Refreshing...</span>
                    </>
                  ) : (
                    <span>Refresh</span>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Documents List */}
              <div className="lg:col-span-1">
                <div className="border rounded-2xl p-6 transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                  <h2 className="text-lg font-semibold mb-4 transition-colors" style={{ color: 'var(--text-primary)' }}>
                    Tracked Files ({documents.length})
                  </h2>
                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {loading ? (
                      <div className="flex items-center gap-2 py-2">
                        <div className="w-4 h-4 border-2 border-slate-700 border-t-slate-500 rounded-full animate-spin"></div>
                        <p className="text-xs text-slate-500">Loading...</p>
                      </div>
                    ) : documents.length === 0 ? (
                      <div className="py-6 text-center">
                        <FileText className="w-8 h-8 mx-auto mb-2 text-slate-700" />
                        <p className="text-xs text-slate-500 mb-1">No documents tracked</p>
                        <p className="text-[10px] text-slate-700">USB file transfers will appear here when detected by the agent</p>
                      </div>
                    ) : (
                      documents.map((doc) => (
                        <button
                          key={doc.id}
                          onClick={() => {
                            setSelectedDocument(doc)
                            router.push(`/documents?id=${doc.id}`, { scroll: false })
                          }}
                          className={`w-full text-left p-3 rounded-lg border transition-all ${selectedDocument?.id === doc.id ? '' : ''
                            }`}
                          style={selectedDocument?.id === doc.id
                            ? { backgroundColor: 'rgba(0, 217, 255, 0.2)', borderColor: 'var(--accent-cyan)' }
                            : { backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }
                          }
                          onMouseEnter={(e) => {
                            if (selectedDocument?.id !== doc.id) {
                              e.currentTarget.style.borderColor = 'var(--accent-cyan)'
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (selectedDocument?.id !== doc.id) {
                              e.currentTarget.style.borderColor = 'var(--border-color)'
                            }
                          }}
                        >
                          <div className="flex items-start space-x-2">
                            <FileText className="w-4 h-4 mt-0.5 flex-shrink-0 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate transition-colors" style={{ color: 'var(--text-primary)' }}>
                                {doc.metadata.file_name || 'Unknown File'}
                              </p>
                              <p className="text-xs mt-1 transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                                {doc.metadata.file_size ? formatFileSize(doc.metadata.file_size) : 'Unknown size'}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Document Details */}
              <div className="lg:col-span-2">
                {selectedDocument ? (
                  <div className="border rounded-2xl p-6 transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center space-x-3">
                        <div className="p-3 rounded-lg transition-colors" style={{ backgroundColor: 'rgba(0, 217, 255, 0.2)' }}>
                          <FileText className="w-6 h-6 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>
                            {selectedDocument.metadata.file_name || 'Unknown File'}
                          </h2>
                          <p className="text-sm mt-1 transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                            {selectedDocument.metadata.file_path || 'Path not available'}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end space-y-2">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => {
                              const filePath = selectedDocument.metadata?.file_path
                              const driveLetter = selectedDocument.metadata?.drive_letter

                              if (filePath) {
                                // Check if it's a USB drive path
                                const isUSBDrive = driveLetter && filePath.startsWith(driveLetter)

                                if (navigator.platform.includes('Win')) {
                                  // Try to open the file directly using Windows shell command
                                  // First, copy path to clipboard
                                  navigator.clipboard.writeText(filePath).then(() => {
                                    const message = isUSBDrive
                                      ? `⚠️ USB Drive File Access\n\n` +
                                      `Path: ${filePath}\n\n` +
                                      `IMPORTANT:\n` +
                                      `1. Ensure the USB drive (${driveLetter}) is still connected\n` +
                                      `2. The path has been copied to your clipboard\n` +
                                      `3. Open File Explorer (Win + E)\n` +
                                      `4. Paste the path in the address bar (Ctrl + V)\n` +
                                      `5. Press Enter to navigate\n\n` +
                                      `If the USB is disconnected, the file won't be accessible.`
                                      : `File Path Copied!\n\n` +
                                      `Path: ${filePath}\n\n` +
                                      `1. Open File Explorer (Win + E)\n` +
                                      `2. Paste the path in the address bar (Ctrl + V)\n` +
                                      `3. Press Enter to navigate`

                                    alert(message)

                                    // Also try to open the folder in File Explorer
                                    if ((window as any).electron || (window as any).require) {
                                      // If Electron app, we could use shell.openPath
                                      try {
                                        const { shell } = (window as any).require('electron')
                                        const folderPath = filePath.substring(0, filePath.lastIndexOf('\\'))
                                        shell.openPath(folderPath)
                                      } catch (e) {
                                        // Not Electron, continue
                                      }
                                    }
                                  }).catch(() => {
                                    alert(`File Path: ${filePath}\n\n${isUSBDrive ? '⚠️ Ensure USB drive is connected!\n\n' : ''}Copy this path and paste it in File Explorer.`)
                                  })
                                } else {
                                  alert(`File Path: ${filePath}\n\n${isUSBDrive ? '⚠️ Ensure USB drive is connected!\n\n' : ''}Navigate to this path to access the file.`)
                                }
                              }
                            }}
                            className="px-4 py-2 rounded-lg transition-all flex items-center space-x-2 font-medium"
                            style={{ backgroundColor: 'var(--accent-purple)', color: '#ffffff' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#5A4FD6'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-purple)'; }}
                            title="Copy file path and open location"
                          >
                            <FileText className="w-4 h-4" />
                            <span>Open Location</span>
                          </button>
                          <button
                            onClick={() => handleDownload(selectedDocument)}
                            className="px-4 py-2 rounded-lg transition-all flex items-center space-x-2 font-medium"
                            style={{ backgroundColor: 'var(--accent-cyan)', color: 'var(--bg-primary)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#00B8E6'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-cyan)'; }}
                            title={selectedDocument.metadata?.backup_file_id ? "Download actual file (backed up)" : "Download metadata information"}
                          >
                            <Download className="w-4 h-4" />
                            <span>{selectedDocument.metadata?.backup_file_id ? 'Download File' : 'Download Info'}</span>
                          </button>
                          {selectedDocument.metadata?.backup_file_id && (
                            <span className="text-xs transition-colors" style={{ color: '#00FF88' }}>✓ File backed up</span>
                          )}
                        </div>
                        {downloadError && (
                          <p className="text-xs px-3 py-1 rounded transition-colors" style={{ color: '#FF6B6B', backgroundColor: 'rgba(255, 107, 107, 0.1)' }}>
                            {downloadError}
                          </p>
                        )}
                        {selectedDocument.metadata?.drive_letter && (
                          <div className="mt-2 p-3 border rounded-lg max-w-xs transition-colors" style={{ backgroundColor: 'rgba(255, 107, 107, 0.1)', borderColor: 'rgba(255, 107, 107, 0.3)' }}>
                            <p className="text-xs font-semibold mb-1 transition-colors" style={{ color: '#FF6B6B' }}>⚠️ USB Drive File</p>
                            <p className="text-xs transition-colors" style={{ color: 'rgba(255, 107, 107, 0.8)' }}>
                              This file is on a USB drive. Browsers cannot access USB drives directly for security reasons.
                            </p>
                            <p className="text-xs mt-2 transition-colors" style={{ color: 'rgba(255, 107, 107, 0.8)' }}>
                              <strong>To access:</strong> Ensure USB is connected, then manually navigate to the path in File Explorer.
                            </p>
                          </div>
                        )}
                        {!selectedDocument.metadata?.drive_letter && (
                          <p className="text-xs text-right max-w-xs transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                            Note: Download Info provides metadata. Use "Open Location" to copy the path.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Document Information */}
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg border transition-colors" style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}>
                          <div className="flex items-center space-x-2 mb-2">
                            <FileText className="w-4 h-4 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
                            <span className="text-xs uppercase transition-colors" style={{ color: 'var(--text-tertiary)' }}>File Size</span>
                          </div>
                          <p className="text-lg font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>
                            {selectedDocument.metadata.file_size
                              ? formatFileSize(selectedDocument.metadata.file_size)
                              : 'Unknown'}
                          </p>
                        </div>

                        <div className={`p-4 rounded-lg border transition-colors ${getDirectionColor(selectedDocument.metadata.direction || '')}`}>
                          <div className="flex items-center space-x-2 mb-2">
                            {getDirectionIcon(selectedDocument.metadata.direction || '')}
                            <span className="text-xs uppercase transition-colors" style={{ color: 'var(--text-tertiary)' }}>Direction</span>
                          </div>
                          <p className="text-lg font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>
                            {selectedDocument.metadata.direction === 'to_usb'
                              ? 'Copied TO USB'
                              : 'Copied FROM USB'}
                          </p>
                        </div>
                      </div>

                      <div className="p-4 rounded-lg border transition-colors" style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}>
                        <h3 className="text-sm font-semibold mb-4 transition-colors" style={{ color: 'var(--text-primary)' }}>Details</h3>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <Calendar className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                              <span className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Timestamp</span>
                            </div>
                            <span className="text-sm transition-colors" style={{ color: 'var(--text-primary)' }}>
                              {formatDate(selectedDocument.timestamp)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <HardDrive className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                              <span className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Device</span>
                            </div>
                            <span className="text-sm transition-colors" style={{ color: 'var(--text-primary)' }}>
                              {selectedDocument.metadata.device_name || selectedDocument.metadata.device_id || 'Unknown'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <User className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                              <span className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Agent ID</span>
                            </div>
                            <span className="text-sm font-mono transition-colors" style={{ color: 'var(--text-primary)' }}>
                              {selectedDocument.agent_id}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <File className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                              <span className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Platform</span>
                            </div>
                            <span className="text-sm capitalize transition-colors" style={{ color: 'var(--text-primary)' }}>
                              {selectedDocument.metadata.platform || 'Unknown'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* File Path */}
                      {selectedDocument.metadata.file_path && (
                        <div className="p-4 rounded-lg border transition-colors" style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>Full Path</h3>
                            {selectedDocument.metadata.drive_letter && (
                              <span className="text-xs px-2 py-1 rounded transition-colors" style={{ backgroundColor: 'rgba(255, 107, 107, 0.2)', color: '#FF6B6B' }}>
                                USB Drive - Ensure Connected
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-mono break-all mb-2 transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                            {selectedDocument.metadata.file_path}
                          </p>
                          {selectedDocument.metadata.drive_letter && (
                            <div className="mt-3 p-3 border rounded-lg transition-colors" style={{ backgroundColor: 'rgba(255, 107, 107, 0.1)', borderColor: 'rgba(255, 107, 107, 0.3)' }}>
                              <p className="text-xs font-semibold mb-2 transition-colors" style={{ color: '#FF6B6B' }}>
                                ⚠️ USB Drive File - Browser Cannot Access Directly
                              </p>
                              <div className="text-xs space-y-2 transition-colors" style={{ color: 'rgba(255, 107, 107, 0.9)' }}>
                                <p>
                                  <strong>Drive:</strong> {selectedDocument.metadata.drive_letter}
                                </p>
                                <p>
                                  <strong>Why "Open Location" doesn't work:</strong> Web browsers block direct access to USB drives and local files for security reasons. This is a browser security limitation, not a bug in the system.
                                </p>
                                <p className="font-semibold mt-2">How to Access the File:</p>
                                <ol className="list-decimal list-inside ml-2 space-y-1">
                                  <li>Ensure the USB drive ({selectedDocument.metadata.drive_letter}) is still connected</li>
                                  <li>Open File Explorer (Press <kbd className="px-1.5 py-0.5 rounded border text-[10px] transition-colors" style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--accent-cyan)' }}>Win + E</kbd>)</li>
                                  <li>Click the "📋 Copy Path" button below to copy the file path</li>
                                  <li>In File Explorer, click the address bar and paste (Ctrl + V)</li>
                                  <li>Press Enter - File Explorer will navigate to the file location</li>
                                </ol>
                                <p className="mt-2 italic transition-colors" style={{ color: 'rgba(255, 107, 107, 0.7)' }}>
                                  If the USB drive has been disconnected, reconnect it first, then follow the steps above.
                                </p>
                              </div>
                            </div>
                          )}
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(selectedDocument.metadata.file_path || '').then(() => {
                                alert('Path copied to clipboard!')
                              })
                            }}
                            className="mt-2 text-xs transition-colors"
                            style={{ color: 'var(--accent-cyan)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#00FF88'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-cyan)'; }}
                          >
                            📋 Copy Path
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="border rounded-2xl p-10 text-center transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                    <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-slate-800/50 border border-white/[0.04] flex items-center justify-center">
                      <FileText className="w-6 h-6 text-slate-600" />
                    </div>
                    <p className="text-sm font-medium mb-1 text-slate-400">No document selected</p>
                    <p className="text-xs text-slate-600">
                      Select a tracked file from the sidebar to view transfer details, metadata, and download options
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

