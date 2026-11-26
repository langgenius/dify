'use client'

import type { LoroDoc, UndoManager } from 'loro-crdt'
import type { Socket } from 'socket.io-client'
import type { WorkflowHistoryEventT } from '../../hooks/use-workflow-history'
import type { LLMNodeType } from '../../nodes/llm/types'
import type { Edge, Node } from '../../types'
import type {
  CollaborationState,
  CollaborationUpdate,
  CursorPosition,
  JoinFailure,
  NodePanelPresenceMap,
  NodePanelPresenceUser,
  OnlineUser,
  RestoreCompleteData,
  RestoreIntentData,
} from '../types/collaboration'
import type {
  LoroDraftConfirmation,
  LoroDraftIdentity,
  LoroDraftProvider,
} from './loro-draft-provider'
import type { LoroDraftRetirement } from './loro-draft-storage'
import type { NodePanelPresenceEventData } from './presence-manager'
import { isEqual } from 'es-toolkit/predicate'
import { v4 as uuid4 } from 'uuid'
import { isAgentV2NodeData, needsInlineAgentBindingCreation } from '../../nodes/agent-v2/types'
import { BlockEnum } from '../../types'
import { inheritDraftRowIds } from './draft-row-identity'
import { EventEmitter } from './event-emitter'
import { PresenceManager } from './presence-manager'
import { emitWithAuthGuard, webSocketClient } from './websocket-manager'
type DraftHistory = Readonly<{
  undo: readonly WorkflowHistoryEventT[]
  redo: readonly WorkflowHistoryEventT[]
}>
type Prompt = LLMNodeType['prompt_template']

type CrdtRuntime = (typeof import('./crdt-runtime'))['crdtRuntime']

type ReactFlowStore = {
  hydrateGraph?: (graph: { nodes: Node[]; edges: Edge[] }) => { nodes: Node[]; edges: Edge[] }
  getState: () => {
    getNodes: () => Node[]
    setNodes: (nodes: Node[]) => void
    getEdges: () => Edge[]
    setEdges: (edges: Edge[]) => void
  }
}

type CollaborationEventPayload = {
  type: CollaborationUpdate['type']
  data: Record<string, unknown>
  timestamp: number
}

type InitialFieldChange = { before: unknown; after: unknown }

const isDraftNode = (node: Node) =>
  node.data?.type !== BlockEnum.StartPlaceholder &&
  (!node.data?._isTempNode ||
    (isAgentV2NodeData(node.data) && needsInlineAgentBindingCreation(node.data)))

export class CollaborationManager {
  private eventEmitter = new EventEmitter()
  private presence = new PresenceManager(this.eventEmitter)
  private connections = new Set<string>()
  private currentAppId?: string
  private loroDraft?: LoroDraftIdentity
  private socket?: Socket
  private unsubscribeSocket?: () => void
  private reactFlowStore?: ReactFlowStore
  private runtime?: CrdtRuntime
  private doc?: LoroDoc
  private undoManager?: UndoManager
  private unsubscribeDocument?: () => void
  private nativePushes = 0
  private provider?: LoroDraftProvider
  private ready = false
  private joined = false
  private previouslyJoined = false
  private joining = false
  private joinRetry?: ReturnType<typeof setTimeout>
  private joinFailure: JoinFailure | null = null
  private initialLlmPrompts?: Map<string, { before: Prompt; prompt: Prompt }>
  private draftHistory: DraftHistory = { undo: [], redo: [] }
  private label: WorkflowHistoryEventT = 'NodeChange'
  private inGroup = false
  private initialization?: { before?: Record<string, unknown> }
  private initializedFields = new Map<string, Map<string, InitialFieldChange>>()
  private lastInput?: { key: string; time: number; start: number }
  private confirmedEmpty = true
  private clearing = false
  private members: Record<'undo' | 'redo', { added: string[]; removed: string[] }[]> = {
    undo: [],
    redo: [],
  }

  onClearRequested(callback: (confirm: () => void) => void) {
    return this.eventEmitter.on('clearRequested', callback)
  }

  shouldConfirmClear(willClear: () => boolean) {
    return !!this.currentAppId && !this.clearing && !this.confirmedEmpty && willClear()
  }

  guardClear(willClear: () => boolean, apply: () => void) {
    if (!this.canApplyLocalGraphMutation()) return
    if (!this.shouldConfirmClear(willClear)) {
      apply()
      return
    }
    const doc = this.doc,
      appId = this.currentAppId!
    this.eventEmitter.emit('clearRequested', () => {
      if (this.doc !== doc || !this.canPersistLocalGraph()) return
      const allowEmpty = willClear()
      this.clearing = true
      try {
        apply()
      } finally {
        this.clearing = false
      }
      if (allowEmpty) void this.syncLoroDraft(appId, true).catch(() => {})
    })
  }

  deletionWillClear(ids: ReadonlySet<string>) {
    const nodes = this.getNodes()
    return (
      nodes.length > 0 &&
      nodes.every((node) => ids.has(node.id) || (!!node.parentId && ids.has(node.parentId)))
    )
  }

  historyWillClear(steps: number) {
    const direction = steps < 0 ? 'undo' : 'redo'
    const ids = new Set(this.getNodes().map((node) => node.id))
    if (!steps || !ids.size) return false
    for (const step of this.members[direction].slice(-Math.abs(steps)).reverse()) {
      for (const id of steps < 0 ? step.added : step.removed) ids.delete(id)
      for (const id of steps < 0 ? step.removed : step.added) ids.add(id)
    }
    return ids.size === 0
  }

  async connect(
    appId: string,
    reactFlowStore: ReactFlowStore | undefined,
    identity: LoroDraftIdentity,
  ) {
    const id = uuid4()
    if (
      this.currentAppId &&
      (this.currentAppId !== appId || this.loroDraft?.accountId !== identity.accountId)
    )
      this.disconnect()
    if (!this.currentAppId) {
      this.currentAppId = appId
      this.loroDraft = identity
      this.initialLlmPrompts = new Map()
      this.setFailure(null)
    } else {
      this.replaceLoroDraft(appId, identity)
    }
    this.connections.add(id)
    if (reactFlowStore) this.reactFlowStore = reactFlowStore
    try {
      this.runtime ??= (await import('./crdt-runtime')).crdtRuntime
    } catch (error) {
      if (this.connections.has(id)) {
        this.disconnect(id)
        this.setFailure('unavailable')
      }
      throw error
    }
    if (!this.connections.has(id) || this.currentAppId !== appId) return id
    if (this.socket) return id
    const socket = webSocketClient.connect(appId)
    this.socket = socket
    this.startDraft()
    const onConnectError = () => {
      if (!this.previouslyJoined) this.setFailure('unavailable')
    }
    const onDisconnect = (reason: string) => {
      this.provider?.leave()
      this.joined = this.joining = false
      clearTimeout(this.joinRetry)
      this.eventEmitter.emit('stateChange', { isConnected: false, disconnectReason: reason })
    }
    const onDraftChanged = (data: Parameters<LoroDraftProvider['pull']>[0]) =>
      this.provider?.pull(data)
    const onOnlineUsers = ({ users }: { users: OnlineUser[] }) => this.presence.updateUsers(users)
    socket.on('connect', this.join)
    socket.on('connect_error', onConnectError)
    socket.on('disconnect', onDisconnect)
    socket.on('loro_draft_changed', onDraftChanged)
    socket.on('online_users', onOnlineUsers)
    socket.on('collaboration_update', this.receive)
    this.unsubscribeSocket = () => {
      socket.off('connect', this.join)
      socket.off('connect_error', onConnectError)
      socket.off('disconnect', onDisconnect)
      socket.off('loro_draft_changed', onDraftChanged)
      socket.off('online_users', onOnlineUsers)
      socket.off('collaboration_update', this.receive)
    }
    if (socket.connected) this.join()
    return id
  }

  private join = () => {
    const socket = this.socket
    if (!socket?.connected || this.joining) return
    clearTimeout(this.joinRetry)
    if (this.joined) {
      this.joined = false
      this.provider?.leave()
      this.eventEmitter.emit('stateChange', { isConnected: false })
    }
    const sid = socket.id
    this.joining = true
    socket
      .timeout(8000)
      .emit(
        'user_connect',
        { workflow_id: this.currentAppId },
        (err: Error | null, body?: { msg?: string }, status?: number) => {
          if (this.socket !== socket || socket.id !== sid || !socket.connected) return
          this.joining = false
          if (err || status === 503) {
            if (!this.previouslyJoined) this.setFailure('unavailable')
            this.joinRetry = setTimeout(this.join, 2000)
          } else if (body?.msg === 'connected') {
            this.joined = this.previouslyJoined = true
            this.setFailure(null)
            this.provider?.join()
            this.eventEmitter.emit('stateChange', { isConnected: true })
          } else {
            this.provider?.leave()
            this.setFailure(this.previouslyJoined ? 'session_unavailable' : 'denied')
          }
        },
      )
  }

  private setFailure(failure: JoinFailure | null) {
    this.joinFailure = failure
    this.eventEmitter.emit('joinFailure', failure)
    this.eventEmitter.emit('graphReady', this.canPersistLocalGraph())
  }

  private startDraft(retirements?: readonly LoroDraftRetirement[]) {
    const runtime = this.runtime!
    const appId = this.currentAppId!
    const doc = new runtime.LoroDoc()
    this.releaseDocument()
    this.doc = doc
    this.provider = new runtime.LoroDraftProvider({
      doc,
      appId,
      socket: this.socket!,
      identity: this.loroDraft!,
      retirements,
      onReady: (isEmpty) => {
        this.bindDocument(doc)
        this.confirmedEmpty = isEmpty
        this.ready = true
        this.applyInitialLlmPrompts()
        this.refreshGraphSynchronously()
        this.eventEmitter.emit('graphReady', this.canPersistLocalGraph())
      },
      onDocument: (doc) => {
        this.bindDocument(doc)
        this.refreshGraphSynchronously()
      },
      onConfirmed: (result) => {
        this.confirmedEmpty = result.isEmpty
        this.eventEmitter.emit('loroDraftConfirmed', result)
      },
      onPendingChange: (pending) => this.eventEmitter.emit('loroDraftPendingChange', pending),
      onEpochChanged: () => {
        this.ready = false
        this.initialLlmPrompts = undefined
        this.eventEmitter.emit('graphReady', false)
        this.eventEmitter.emit('workflowUpdate', { appId, timestamp: Date.now() })
      },
      onEmptyConfirmationRequired: () =>
        this.guardClear(
          () => this.getNodes().length === 0,
          () => {},
        ),
      onUnavailable: () => this.setFailure('session_unavailable'),
      onUnauthorized: this.join,
    })
    if (this.joined) this.provider.join()
  }

  private releaseDocument() {
    this.unsubscribeDocument?.()
    this.unsubscribeDocument = undefined
    this.undoManager?.free()
    this.undoManager = undefined
  }

  private bindDocument(doc: LoroDoc) {
    this.releaseDocument()
    this.doc = doc
    this.initializedFields.clear()
    this.inGroup = false
    this.lastInput = undefined
    this.draftHistory = { undo: [], redo: [] }
    this.members = { undo: [], redo: [] }
    this.undoManager = new this.runtime!.UndoManager(doc, {
      maxUndoSteps: 100,
      mergeInterval: 0,
      excludeOriginPrefixes: ['draft-system'],
      onPush: (_isUndo, span) => {
        this.nativePushes++
        return { value: span.start, cursors: [] }
      },
    })
    this.unsubscribeDocument = doc.subscribe((event) => {
      if (doc !== this.doc || event.by !== 'import' || !this.ready) return
      this.lastInput = undefined
      this.refreshGraphSynchronously()
    })
    this.emitHistory()
  }

  private emitHistory() {
    this.eventEmitter.emit('undoRedoStateChange', {
      canUndo: !!this.undoManager?.canUndo(),
      canRedo: !!this.undoManager?.canRedo(),
    })
  }

  disconnect = (id?: string) => {
    if (id && (!this.connections.delete(id) || this.connections.size)) return
    this.connections.clear()
    clearTimeout(this.joinRetry)
    this.provider?.destroy()
    this.releaseDocument()
    this.unsubscribeSocket?.()
    this.unsubscribeSocket = undefined
    if (this.currentAppId && this.socket) webSocketClient.disconnect(this.currentAppId)
    this.provider =
      this.socket =
      this.doc =
      this.loroDraft =
      this.currentAppId =
      this.reactFlowStore =
        undefined
    this.initialLlmPrompts = undefined
    this.confirmedEmpty = true
    this.inGroup = false
    this.lastInput = undefined
    this.initializedFields.clear()
    this.joined = this.joining = this.previouslyJoined = this.ready = false
    this.clearUndoStack()
    this.presence.updateUsers([])
    this.eventEmitter.emit('stateChange', { isConnected: false })
    this.setFailure(null)
  }

  private receive = (update: CollaborationUpdate) => {
    switch (update.type) {
      case 'mouse_move':
        return this.presence.move(update)
      case 'node_panel_presence':
        return this.presence.applyNodePanelPresenceUpdate(update.data as NodePanelPresenceEventData)
      case 'vars_and_features_update':
        return this.eventEmitter.emit('varsAndFeaturesUpdate', update)
      case 'app_meta_update':
        return this.eventEmitter.emit('appMetaUpdate', update)
      case 'app_publish_update':
        return this.eventEmitter.emit('appPublishUpdate', update)
      case 'workflow_update':
        return this.eventEmitter.emit('workflowUpdate', update.data)
      case 'comments_update':
        return this.eventEmitter.emit('commentsUpdate', update.data)
      case 'workflow_restore_intent':
        return this.eventEmitter.emit('restoreIntent', update.data)
      case 'workflow_restore_complete':
        return this.eventEmitter.emit('restoreComplete', update.data)
      case 'workflow_history_action':
        return this.eventEmitter.emit('historyAction', {
          action: update.data.action,
          userId: update.userId,
        })
    }
  }

  private sendCollaborationEvent(payload: CollaborationEventPayload) {
    if (!this.isConnected() || this.joinFailure) return false
    emitWithAuthGuard(this.socket, 'collaboration_event', payload, { onUnauthorized: this.join })
    return true
  }

  onJoinFailure(callback: (failure: JoinFailure | null) => void) {
    callback(this.joinFailure)
    return this.eventEmitter.on('joinFailure', callback)
  }
  onGraphReadyChange(callback: (ready: boolean) => void) {
    callback(this.canPersistLocalGraph())
    return this.eventEmitter.on('graphReady', callback)
  }
  canPersistLocalGraph() {
    return this.ready && !this.joinFailure
  }
  canApplyLocalGraphMutation() {
    return !this.currentAppId || this.canPersistLocalGraph()
  }
  isConnected() {
    return !!this.socket?.connected && this.joined
  }
  usesLoroDraft(appId: string) {
    return this.currentAppId === appId
  }
  isDraftHistoryReady(appId: string, identity: LoroDraftIdentity) {
    return (
      this.usesLoroDraft(appId) && isEqual(this.loroDraft, identity) && this.canPersistLocalGraph()
    )
  }
  clearUndoStack() {
    this.undoManager?.clear()
    this.members = { undo: [], redo: [] }
    this.draftHistory = { undo: [], redo: [] }
    this.emitHistory()
  }
  getDraftHistory() {
    return this.draftHistory
  }

  private record(label: WorkflowHistoryEventT, apply: () => void, inputKey?: string) {
    const undo = this.undoManager!,
      doc = this.doc!
    const now = Date.now()
    const merge = !!inputKey && this.lastInput?.key === inputKey && now - this.lastInput.time < 500
    const lastStart = this.lastInput?.start ?? now
    undo.setMergeInterval(merge ? now - lastStart + 500 : 0)
    const previousTop = undo.topUndoValue()
    const previousPushes = this.nativePushes
    const before = new Set(doc.getMap('nodes').keys())
    apply()
    if (previousPushes === this.nativePushes) return
    const newStep = undo.topUndoValue() !== previousTop
    this.lastInput = inputKey
      ? { key: inputKey, time: now, start: newStep ? now : lastStart }
      : undefined
    const after = new Set(doc.getMap('nodes').keys())
    const added = [...after].filter((id) => !before.has(id)),
      removed = [...before].filter((id) => !after.has(id))
    if (newStep) {
      this.members = { undo: [...this.members.undo.slice(-99), { added, removed }], redo: [] }
      this.draftHistory = {
        undo: [...this.draftHistory.undo.slice(-99), this.inGroup ? this.label : label],
        redo: [],
      }
      this.emitHistory()
    } else {
      const step = this.members.undo.at(-1)
      if (step) {
        const previousAdded = step.added,
          previousRemoved = step.removed
        step.added = [
          ...previousAdded.filter((id) => !removed.includes(id)),
          ...added.filter((id) => !previousRemoved.includes(id)),
        ]
        step.removed = [
          ...previousRemoved.filter((id) => !added.includes(id)),
          ...removed.filter((id) => !previousAdded.includes(id)),
        ]
      }
    }
  }

  beginDraftHistoryAction(label: WorkflowHistoryEventT) {
    if (!this.canPersistLocalGraph() || !this.undoManager || this.inGroup) return () => {}
    const undo = this.undoManager
    this.inGroup = true
    this.label = label
    undo.groupStart()
    return () => {
      if (this.undoManager !== undo || !this.inGroup) return
      undo.groupEnd()
      this.inGroup = false
    }
  }
  runDraftHistoryAction<T>(label: WorkflowHistoryEventT, apply: () => T): T {
    const end = this.beginDraftHistoryAction(label)
    try {
      return apply()
    } finally {
      end()
    }
  }
  runDraftInitialization(apply: () => void, before?: Record<string, unknown>) {
    const previous = this.initialization
    this.initialization = { before }
    try {
      apply()
    } finally {
      this.initialization = previous
    }
  }

  setNodes = (before: Node[], after: Node[]) => {
    if (!this.canPersistLocalGraph()) return
    const label =
      after.length > before.length
        ? 'NodeAdd'
        : after.length < before.length
          ? 'NodeDelete'
          : 'NodeDragStop'
    this.record(label, () =>
      this.runtime!.changeDraftEntities(
        this.doc!,
        'nodes',
        before.filter(isDraftNode),
        after.filter(isDraftNode),
      ),
    )
  }
  setEdges = (before: Edge[], after: Edge[]) => {
    if (!this.canPersistLocalGraph()) return
    const excluded = new Set(
      this.reactFlowStore
        ?.getState()
        .getNodes()
        .filter((n) => !isDraftNode(n))
        .map((n) => n.id),
    )
    const keep = (e: Edge) => !e.data?._isTemp && !excluded.has(e.source) && !excluded.has(e.target)
    this.record(after.length < before.length ? 'EdgeDelete' : 'NodeConnect', () =>
      this.runtime!.changeDraftEntities(
        this.doc!,
        'edges',
        before.filter(keep),
        after.filter(keep),
      ),
    )
  }
  updateDraftNodeData(id: string, before: Record<string, unknown>, after: Record<string, unknown>) {
    if (!this.canPersistLocalGraph()) return false
    const version = this.doc!.version()
    const initial = this.initialization
    const field = changedStringPath(before, after)
    const key = field ? JSON.stringify([id, field]) : undefined
    if (initial) {
      const baseline = initial.before ?? before
      const initialized = this.initializedFields.get(id) ?? new Map<string, InitialFieldChange>()
      this.initializedFields.set(id, initialized)
      const previous: Record<string, unknown> = {},
        defaults: Record<string, unknown> = {}
      for (const [field, value] of Object.entries(after)) {
        const change = { before: baseline[field], after: value }
        if (isEqual(change.before, value) || isEqual(initialized.get(field), change)) continue
        previous[field] = change.before
        defaults[field] = value
        initialized.set(field, change)
      }
      this.runtime!.changeDraftData(this.doc!, id, previous, defaults, true)
    } else {
      this.record(
        field?.[0] === 'title'
          ? 'NodeTitleChange'
          : field?.[0] === 'desc'
            ? 'NodeDescriptionChange'
            : 'NodeChange',
        () => this.runtime!.changeDraftData(this.doc!, id, before, after),
        key,
      )
    }
    const view = Object.fromEntries(
      Object.entries(after).filter(([k]) => k === 'selected' || k.startsWith('_')),
    )
    if (
      version.compare(this.doc!.version()) !== 0 ||
      Object.keys(view).some((k) => !isEqual(before[k], view[k]))
    )
      this.refreshGraphSynchronously({ id, fields: view })
    return true
  }

  private step(action: 'undo' | 'redo') {
    const undo = this.undoManager
    if (
      !this.canPersistLocalGraph() ||
      !undo ||
      !(action === 'undo' ? undo.canUndo() : undo.canRedo())
    )
      return undefined
    const applied = undo[action]()
    const other = action === 'undo' ? 'redo' : 'undo'
    const membership = this.members[action].pop()
    if (applied && membership) this.members[other].push(membership)
    const labels = this.draftHistory[action]
    this.draftHistory = {
      ...this.draftHistory,
      [action]: labels.slice(0, -1),
      [other]: applied
        ? [...this.draftHistory[other], labels.at(-1) ?? 'NodeChange']
        : this.draftHistory[other],
    }
    this.lastInput = undefined
    if (applied) this.refreshGraphSynchronously()
    this.emitHistory()
    return applied ? 'applied' : 'consumed'
  }
  undo() {
    return this.step('undo')
  }
  redo() {
    return this.step('redo')
  }
  getNodes() {
    return this.doc ? this.runtime!.projectDraftGraph(this.doc).nodes : []
  }
  getEdges() {
    return this.doc ? this.runtime!.projectDraftGraph(this.doc).edges : []
  }
  setLoroDraftViewport(vp: { x: number; y: number; zoom: number }) {
    if (this.canPersistLocalGraph()) this.runtime!.setDraftViewport(this.doc!, vp)
  }

  replaceLoroDraft(appId: string, identity: LoroDraftIdentity) {
    if (
      !this.usesLoroDraft(appId) ||
      this.loroDraft?.accountId !== identity.accountId ||
      isEqual(identity, this.loroDraft)
    )
      return false
    const retirements = this.provider?.retirementCandidates
    this.provider?.destroy()
    this.loroDraft = identity
    this.initialLlmPrompts = undefined
    this.ready = false
    this.eventEmitter.emit('graphReady', false)
    if (this.socket) this.startDraft(retirements)
    return true
  }
  syncLoroDraft(appId: string, allowEmpty = false) {
    if (!this.usesLoroDraft(appId) || !this.provider)
      return Promise.reject(new Error('Draft is not ready.'))
    return this.provider.flush(allowEmpty)
  }
  queueInitialLlmPrompt(
    appId: string,
    identity: LoroDraftIdentity,
    nodeId: string,
    prompt: Prompt,
    previousPrompt: Prompt,
  ): boolean {
    if (
      !this.initialLlmPrompts ||
      this.currentAppId !== appId ||
      !isEqual(this.loroDraft, identity) ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    )
      return false

    this.initialLlmPrompts.set(nodeId, {
      before: this.initialLlmPrompts.get(nodeId)?.before ?? previousPrompt,
      prompt,
    })
    return true
  }

  private applyInitialLlmPrompts(): void {
    const prompts = this.initialLlmPrompts
    this.initialLlmPrompts = undefined
    if (!prompts?.size) return

    for (const [nodeId, { before, prompt }] of prompts) {
      const node = this.getNodes().find((item) => item.id === nodeId)
      if (node?.data.type !== BlockEnum.LLM) continue
      const current = (node.data as LLMNodeType).prompt_template
      if (current !== undefined && Array.isArray(current) !== Array.isArray(prompt)) continue
      this.updateDraftNodeData(nodeId, { prompt_template: before }, { prompt_template: prompt })
    }
  }

  async getOnlineUserAvatars(appId: string): Promise<Record<string, string>> {
    const socket = this.socket
    if (this.currentAppId !== appId || !socket?.connected) return {}

    const sid = socket.id
    const avatars = (await socket.timeout(5000).emitWithAck('get_online_user_avatars')) as Record<
      string,
      string
    >
    return this.socket === socket && socket.id === sid ? avatars : {}
  }

  emitCursorMove(position: CursorPosition): void {
    this.sendCollaborationEvent({
      type: 'mouse_move',
      data: { x: position.x, y: position.y },
      timestamp: Date.now(),
    })
  }

  emitWorkflowUpdate(appId: string): void {
    if (!this.usesLoroDraft(appId)) return

    const timestamp = Date.now()
    this.provider?.pull()
    this.eventEmitter.emit('workflowUpdate', { appId, timestamp })
    this.sendCollaborationEvent({
      type: 'workflow_update',
      data: { appId, timestamp },
      timestamp,
    })
  }

  emitAppPublishUpdate(appId: string) {
    if (!this.usesLoroDraft(appId)) return
    const timestamp = Date.now()
    this.sendCollaborationEvent({
      type: 'app_publish_update',
      data: { action: 'published', timestamp },
      timestamp,
    })
  }

  onLoroDraftConfirmed(callback: (result: LoroDraftConfirmation) => void): () => void {
    return this.eventEmitter.on('loroDraftConfirmed', callback)
  }

  onLoroDraftPendingChange(callback: (pending: boolean) => void): () => void {
    return this.eventEmitter.on('loroDraftPendingChange', callback)
  }

  emitNodePanelPresence(nodeId: string, isOpen: boolean, user: NodePanelPresenceUser): void {
    const clientId = this.socket?.id
    if (!clientId || !nodeId || !user.userId) return

    const payload: NodePanelPresenceEventData = {
      nodeId,
      action: isOpen ? 'open' : 'close',
      user,
      clientId,
      timestamp: Date.now(),
    }

    if (
      this.sendCollaborationEvent({
        type: 'node_panel_presence',
        data: payload,
        timestamp: payload.timestamp,
      })
    )
      this.presence.applyNodePanelPresenceUpdate(payload)
  }

  onGraphImport(callback: (payload: { nodes: Node[]; edges: Edge[] }) => void): () => void {
    return this.eventEmitter.on('graphImport', callback)
  }

  onStateChange(callback: (state: Partial<CollaborationState>) => void): () => void {
    return this.eventEmitter.on('stateChange', callback)
  }

  onCursorUpdate(callback: (cursors: Record<string, CursorPosition>) => void): () => void {
    callback(this.presence.getCursors())
    return this.eventEmitter.on('cursors', callback)
  }

  onOnlineUsersUpdate(callback: (users: OnlineUser[]) => void): () => void {
    callback(this.presence.getOnlineUsers())
    return this.eventEmitter.on('onlineUsers', callback)
  }

  onWorkflowUpdate(callback: (update: { appId: string; timestamp: number }) => void): () => void {
    return this.eventEmitter.on('workflowUpdate', callback)
  }

  onVarsAndFeaturesUpdate(callback: (update: CollaborationUpdate) => void): () => void {
    return this.eventEmitter.on('varsAndFeaturesUpdate', callback)
  }

  onAppPublishUpdate(callback: (update: CollaborationUpdate) => void): () => void {
    return this.eventEmitter.on('appPublishUpdate', callback)
  }

  onAppMetaUpdate(callback: (update: CollaborationUpdate) => void): () => void {
    return this.eventEmitter.on('appMetaUpdate', callback)
  }

  onNodePanelPresenceUpdate(callback: (presence: NodePanelPresenceMap) => void): () => void {
    const off = this.eventEmitter.on('nodePanelPresence', callback)
    callback(this.presence.getNodePanelPresenceSnapshot())
    return off
  }

  onCommentsUpdate(callback: (update: { appId: string; timestamp: number }) => void): () => void {
    return this.eventEmitter.on('commentsUpdate', callback)
  }

  emitCommentsUpdate(appId: string): void {
    if (!this.usesLoroDraft(appId)) return

    this.sendCollaborationEvent({
      type: 'comments_update',
      data: { appId, timestamp: Date.now() },
      timestamp: Date.now(),
    })
  }

  emitHistoryAction(action: 'undo' | 'redo' | 'jump'): void {
    this.sendCollaborationEvent({
      type: 'workflow_history_action',
      data: { action },
      timestamp: Date.now(),
    })
  }

  onUndoRedoStateChange(
    callback: (state: { canUndo: boolean; canRedo: boolean }) => void,
  ): () => void {
    return this.eventEmitter.on('undoRedoStateChange', callback)
  }

  onHistoryAction(
    callback: (payload: { action: 'undo' | 'redo' | 'jump'; userId?: string }) => void,
  ): () => void {
    return this.eventEmitter.on('historyAction', callback)
  }

  emitRestoreIntent(data: RestoreIntentData): void {
    this.sendCollaborationEvent({
      type: 'workflow_restore_intent',
      data: data as Record<string, unknown>,
      timestamp: Date.now(),
    })
  }

  emitRestoreComplete(data: RestoreCompleteData): void {
    this.sendCollaborationEvent({
      type: 'workflow_restore_complete',
      data: data as Record<string, unknown>,
      timestamp: Date.now(),
    })
  }

  onRestoreIntent(callback: (data: RestoreIntentData) => void): () => void {
    return this.eventEmitter.on('restoreIntent', callback)
  }

  onRestoreComplete(callback: (data: RestoreCompleteData) => void): () => void {
    return this.eventEmitter.on('restoreComplete', callback)
  }

  refreshGraphSynchronously(localUpdate?: { id: string; fields: Record<string, unknown> }): void {
    const graph = this.doc ? this.runtime!.projectDraftGraph(this.doc) : { nodes: [], edges: [] }
    const mergedNodes = this.mergeLocalNodeState(graph.nodes).map((node) =>
      node.id === localUpdate?.id
        ? { ...node, data: { ...node.data, ...localUpdate.fields } }
        : node,
    )
    this.emitImportedGraph({
      nodes: mergedNodes,
      edges: graph.edges,
    })
  }

  private emitImportedGraph(graph: { nodes: Node[]; edges: Edge[] }): void {
    const local = this.reactFlowStore?.getState()
    if (local) {
      const transient = local
        .getNodes()
        .filter((node) => !isDraftNode(node) && node.data.type !== BlockEnum.StartPlaceholder)
      const transientIds = new Set(transient.map((node) => node.id))
      const localEdges = new Map(local.getEdges().map((edge) => [edge.id, edge]))
      const edges = graph.edges.map((edge) => {
        const previous = localEdges.get(edge.id)
        if (!previous) return edge
        localEdges.delete(edge.id)
        const view = Object.fromEntries(
          Object.entries(previous.data ?? {}).filter(([key]) => key.startsWith('_')),
        )
        return {
          ...edge,
          ...(previous.selected !== undefined ? { selected: previous.selected } : {}),
          ...(edge.data ? { data: { ...edge.data, ...view } } : {}),
        }
      })
      for (const edge of localEdges.values()) {
        if (edge.data?._isTemp || transientIds.has(edge.source) || transientIds.has(edge.target))
          edges.push(edge)
      }
      graph = {
        nodes: [
          ...graph.nodes,
          ...transient.filter((node) => !graph.nodes.some((item) => item.id === node.id)),
        ],
        edges,
      }
    }
    const hydrated = this.reactFlowStore?.hydrateGraph?.(graph) ?? graph
    const projected = new Map(graph.nodes.map((node) => [node.id, node.data]))
    for (const node of hydrated.nodes) inheritDraftRowIds(projected.get(node.id), node.data)
    this.eventEmitter.emit('graphImport', hydrated)
  }
  private mergeLocalNodeState(nodes: Node[]): Node[] {
    const reactFlowStore = this.reactFlowStore
    const state = reactFlowStore?.getState()
    const localNodes = state?.getNodes() || []

    if (localNodes.length === 0) return nodes

    const localNodesMap = new Map(localNodes.map((node) => [node.id, node]))
    return nodes.map((node) => {
      const localNode = localNodesMap.get(node.id)
      if (!localNode) return node

      const nextNode = { ...node }
      const nextData = { ...(nextNode.data || {}) } as Node['data']
      const nextDataRecord = nextData as Record<string, unknown>
      const localData = localNode.data as Record<string, unknown> | undefined

      if (localData) {
        Object.entries(localData).forEach(([key, value]) => {
          if (key === 'selected' || key.startsWith('_')) nextDataRecord[key] = value
        })
      }

      if (
        !Object.prototype.hasOwnProperty.call(nextDataRecord, 'selected') &&
        localNode.selected !== undefined
      )
        nextDataRecord.selected = localNode.selected

      if (localNode.selected !== undefined) nextNode.selected = localNode.selected
      nextNode.data = nextData
      return nextNode
    })
  }

  downloadGraphImportLog() {
    if (!this.doc) return
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify({
            appId: this.currentAppId,
            epoch: this.loroDraft?.epoch,
            graph: this.runtime!.projectDraftGraph(this.doc),
          }),
        ],
        { type: 'application/json' },
      ),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'workflow-collaboration.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function changedStringPath(before: unknown, after: unknown): string[] | undefined {
  if (typeof after === 'string' && before !== after) return []
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return
  const left = before as Record<string, unknown>,
    right = after as Record<string, unknown>
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
    (k) => !isEqual(left[k], right[k]),
  )
  if (keys.length !== 1) return
  const key = keys[0]!,
    rest = changedStringPath(left[key], right[key])
  if (rest) return [key, ...rest]
}

export const collaborationManager = new CollaborationManager()
export const runDraftInitialization = (apply: () => void, before?: Record<string, unknown>) =>
  collaborationManager.runDraftInitialization(apply, before)
