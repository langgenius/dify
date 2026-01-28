import type { Socket } from 'socket.io-client'
import type { CollaborationUpdate } from '@/app/components/workflow/collaboration/types/collaboration'
import { LoroDoc } from 'loro-crdt'
import { EventEmitter } from '@/app/components/workflow/collaboration/core/event-emitter'
import { emitWithAuthGuard, webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'

type SkillUpdatePayload = {
  file_id: string
  update: Uint8Array
  is_snapshot?: boolean
}

type SkillStatusPayload = {
  file_id: string
  isLeader: boolean
}

type SkillCursorPayload = {
  file_id: string
  start?: number | null
  end?: number | null
}

type SkillDocEntry = {
  doc: LoroDoc
  text: ReturnType<LoroDoc['getText']>
  subscribers: Set<(text: string, source: 'remote') => void>
  suppressBroadcast: boolean
}

type SkillCursorInfo = {
  userId: string
  start: number
  end: number
  timestamp: number
}

type SkillCursorMap = Record<string, SkillCursorInfo>

class SkillCollaborationManager {
  private appId: string | null = null
  private socket: Socket | null = null
  private docs = new Map<string, SkillDocEntry>()
  private leaderByFile = new Map<string, boolean>()
  private syncHandlers = new Map<string, Set<() => void>>()
  private activeFileId: string | null = null
  private pendingResync = new Set<string>()
  private cursorByFile = new Map<string, SkillCursorMap>()
  private cursorEmitter = new EventEmitter()

  private handleSkillUpdate = (payload: SkillUpdatePayload) => {
    if (!payload || !payload.file_id || !payload.update)
      return

    if (payload.is_snapshot) {
      this.replaceEntryWithSnapshot(payload.file_id, payload.update)
      return
    }

    const entry = this.docs.get(payload.file_id)
    if (!entry)
      return

    try {
      entry.doc.import(new Uint8Array(payload.update))
    }
    catch (error) {
      console.error('Failed to import skill update:', error)
    }
  }

  private handleSkillStatus = (payload: SkillStatusPayload) => {
    if (!payload || !payload.file_id)
      return

    this.leaderByFile.set(payload.file_id, !!payload.isLeader)
  }

  private handleCollaborationUpdate = (update: CollaborationUpdate) => {
    if (!update || !update.type)
      return

    if (update.type === 'skill_cursor') {
      const data = update.data as SkillCursorPayload | undefined
      const fileId = data?.file_id
      if (!fileId || !update.userId)
        return

      const start = typeof data?.start === 'number' ? data.start : null
      const end = typeof data?.end === 'number' ? data.end : null
      if (start === null || end === null || start < 0 || end < 0) {
        this.updateCursor(fileId, update.userId, null)
        return
      }

      this.updateCursor(fileId, update.userId, {
        userId: update.userId,
        start,
        end,
        timestamp: update.timestamp,
      })
      return
    }

    if (update.type === 'skill_resync_request') {
      const fileId = (update.data as { file_id?: string } | undefined)?.file_id
      if (!fileId || !this.isLeader(fileId))
        return
      this.emitSnapshot(fileId)
      return
    }

    if (update.type === 'skill_sync_request') {
      const fileId = (update.data as { file_id?: string } | undefined)?.file_id
      if (!fileId || !this.isLeader(fileId))
        return
      const handlers = this.syncHandlers.get(fileId)
      handlers?.forEach(handler => handler())
    }
  }

  private handleConnect = () => {
    if (this.activeFileId)
      this.emitSkillFileActive(this.activeFileId, true)

    if (this.pendingResync.size > 0) {
      Array.from(this.pendingResync).forEach(fileId => this.emitResyncRequest(fileId))
      this.pendingResync.clear()
    }
  }

  private ensureSocket(appId: string): Socket {
    if (this.appId && this.appId !== appId) {
      this.teardownSocket()
      this.docs.clear()
      this.leaderByFile.clear()
      this.syncHandlers.clear()
      this.activeFileId = null
      this.pendingResync.clear()
      this.cursorByFile.clear()
      this.cursorEmitter.removeAllListeners()
    }

    this.appId = appId
    const socket = webSocketClient.connect(appId)
    if (this.socket !== socket) {
      this.teardownSocket()
      this.socket = socket
      this.bindSocketListeners(socket)
    }

    return socket
  }

  private bindSocketListeners(socket: Socket) {
    socket.on('skill_update', this.handleSkillUpdate)
    socket.on('skill_status', this.handleSkillStatus)
    socket.on('collaboration_update', this.handleCollaborationUpdate)
    socket.on('connect', this.handleConnect)
  }

  private teardownSocket() {
    if (!this.socket)
      return

    this.socket.off('skill_update', this.handleSkillUpdate)
    this.socket.off('skill_status', this.handleSkillStatus)
    this.socket.off('collaboration_update', this.handleCollaborationUpdate)
    this.socket.off('connect', this.handleConnect)
    this.socket = null
  }

  openFile(appId: string, fileId: string, initialContent: string): void {
    if (!appId || !fileId)
      return

    const socket = this.ensureSocket(appId)

    if (!this.docs.has(fileId)) {
      const doc = new LoroDoc()
      const text = doc.getText('content')
      const entry = this.createEntry(fileId, doc, text)
      entry.suppressBroadcast = true

      if (initialContent)
        text.update(initialContent)

      doc.commit()
      entry.suppressBroadcast = false

      this.docs.set(fileId, entry)
    }

    if (socket.connected)
      this.emitResyncRequest(fileId)
    else
      this.pendingResync.add(fileId)
  }

  closeFile(fileId: string): void {
    if (!fileId)
      return

    if (this.activeFileId === fileId)
      this.activeFileId = null
  }

  updateText(fileId: string, text: string): void {
    const entry = this.docs.get(fileId)
    if (!entry)
      return
    if (entry.text.toString() === text)
      return

    entry.text.update(text)
    entry.doc.commit()
  }

  getText(fileId: string): string | null {
    const entry = this.docs.get(fileId)
    return entry ? entry.text.toString() : null
  }

  subscribe(fileId: string, callback: (text: string, source: 'remote') => void): () => void {
    const entry = this.docs.get(fileId)
    if (!entry)
      return () => {}

    entry.subscribers.add(callback)
    return () => {
      entry.subscribers.delete(callback)
    }
  }

  onSyncRequest(fileId: string, callback: () => void): () => void {
    const handlers = this.syncHandlers.get(fileId) || new Set()
    handlers.add(callback)
    this.syncHandlers.set(fileId, handlers)
    return () => {
      const current = this.syncHandlers.get(fileId)
      if (!current)
        return
      current.delete(callback)
      if (current.size === 0)
        this.syncHandlers.delete(fileId)
    }
  }

  onCursorUpdate(fileId: string, callback: (cursors: SkillCursorMap) => void): () => void {
    if (!fileId)
      return () => {}

    const eventKey = this.getCursorEventKey(fileId)
    const off = this.cursorEmitter.on(eventKey, callback)
    callback({ ...(this.cursorByFile.get(fileId) || {}) })
    return off
  }

  isLeader(fileId: string): boolean {
    return this.leaderByFile.get(fileId) || false
  }

  isFileCollaborative(fileId: string): boolean {
    return this.docs.has(fileId)
  }

  requestSync(fileId: string): void {
    this.emitSyncRequest(fileId)
  }

  emitCursorUpdate(fileId: string, cursor: { start: number, end: number } | null): void {
    if (!fileId || !this.socket || !this.socket.connected)
      return

    const payload: SkillCursorPayload = {
      file_id: fileId,
      start: cursor?.start ?? null,
      end: cursor?.end ?? null,
    }

    emitWithAuthGuard(this.socket, 'collaboration_event', {
      type: 'skill_cursor',
      data: payload,
      timestamp: Date.now(),
    })
  }

  setActiveFile(appId: string, fileId: string, active: boolean): void {
    if (!appId || !fileId)
      return

    this.ensureSocket(appId)

    if (active)
      this.activeFileId = fileId
    else if (this.activeFileId === fileId)
      this.activeFileId = null

    if (this.socket?.connected)
      this.emitSkillFileActive(fileId, active)
  }

  private emitUpdate(fileId: string, update: Uint8Array): void {
    if (!this.socket || !this.socket.connected || !this.appId)
      return

    const payload: SkillUpdatePayload = { file_id: fileId, update }
    emitWithAuthGuard(this.socket, 'skill_event', payload)
  }

  private emitSnapshot(fileId: string): void {
    const entry = this.docs.get(fileId)
    if (!entry || !this.socket || !this.socket.connected)
      return

    const snapshot = entry.doc.export({ mode: 'snapshot' })
    const payload: SkillUpdatePayload = { file_id: fileId, update: snapshot, is_snapshot: true }
    emitWithAuthGuard(this.socket, 'skill_event', payload)
  }

  private emitResyncRequest(fileId: string): void {
    if (!this.socket || !this.socket.connected)
      return

    emitWithAuthGuard(this.socket, 'collaboration_event', {
      type: 'skill_resync_request',
      data: { file_id: fileId },
      timestamp: Date.now(),
    })
  }

  private emitSyncRequest(fileId: string): void {
    if (!this.socket || !this.socket.connected)
      return

    emitWithAuthGuard(this.socket, 'collaboration_event', {
      type: 'skill_sync_request',
      data: { file_id: fileId },
      timestamp: Date.now(),
    })
  }

  private emitSkillFileActive(fileId: string, active: boolean): void {
    if (!this.socket || !this.socket.connected)
      return

    emitWithAuthGuard(this.socket, 'collaboration_event', {
      type: 'skill_file_active',
      data: { file_id: fileId, active },
      timestamp: Date.now(),
    })
  }

  private getCursorEventKey(fileId: string): string {
    return `skill_cursor:${fileId}`
  }

  private updateCursor(fileId: string, userId: string, cursor: SkillCursorInfo | null): void {
    const current = this.cursorByFile.get(fileId) || {}
    if (!cursor) {
      if (!current[userId])
        return
      delete current[userId]
      this.cursorByFile.set(fileId, current)
      this.cursorEmitter.emit(this.getCursorEventKey(fileId), { ...current })
      return
    }

    current[userId] = cursor
    this.cursorByFile.set(fileId, current)
    this.cursorEmitter.emit(this.getCursorEventKey(fileId), { ...current })
  }

  private subscribeDoc(fileId: string, entry: SkillDocEntry) {
    entry.doc.subscribe((event: { by?: string }) => {
      if (event.by === 'local') {
        if (entry.suppressBroadcast)
          return
        const update = entry.doc.export({ mode: 'update' })
        this.emitUpdate(fileId, update)
        return
      }

      const nextText = entry.text.toString()
      entry.subscribers.forEach(callback => callback(nextText, 'remote'))
    })
  }

  private createEntry(fileId: string, doc: LoroDoc, text: ReturnType<LoroDoc['getText']>) {
    const entry: SkillDocEntry = {
      doc,
      text,
      subscribers: new Set(),
      suppressBroadcast: false,
    }

    this.subscribeDoc(fileId, entry)
    return entry
  }

  private replaceEntryWithSnapshot(fileId: string, snapshot: Uint8Array) {
    const existing = this.docs.get(fileId)
    const subscribers = existing?.subscribers ?? new Set<(text: string, source: 'remote') => void>()
    const doc = new LoroDoc()
    try {
      doc.import(new Uint8Array(snapshot))
    }
    catch (error) {
      console.error('Failed to import skill snapshot:', error)
      return
    }

    const text = doc.getText('content')
    const entry: SkillDocEntry = {
      doc,
      text,
      subscribers,
      suppressBroadcast: false,
    }
    this.subscribeDoc(fileId, entry)
    this.docs.set(fileId, entry)

    const nextText = text.toString()
    entry.subscribers.forEach(callback => callback(nextText, 'remote'))
  }
}

export const skillCollaborationManager = new SkillCollaborationManager()
