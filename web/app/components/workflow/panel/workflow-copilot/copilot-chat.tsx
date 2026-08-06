import type { FC } from 'react'
import type { CommonNodeType, Edge, Node } from '../../types'
import type { CopilotConversation, CopilotGraph, CopilotUsage } from './service'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { RiAddLine, RiArrowGoBackLine, RiCheckLine, RiDeleteBinLine, RiRefreshLine, RiSparkling2Line, RiStopCircleLine } from '@remixicon/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow, useNodes as useReactFlowNodes, useStoreApi } from 'reactflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useStore as useWorkflowStore } from '@/app/components/workflow/store'
import { useIsChatMode, useNodesInteractions, useNodesReadOnly } from '../../hooks'
import { useNodesSyncDraft } from '../../hooks/use-nodes-sync-draft'
import { useWorkflowUpdate } from '../../hooks/use-workflow-update'
import {
  deleteCopilotConversation,
  fetchCopilotMessages,
  generateWorkflowCopilot,
  listCopilotConversations,
} from './service'

/**
 * Copilot chat logic for the in-editor workflow generator panel.
 *
 * This panel *builds* the workflow across multiple turns. Each turn sends the
 * live canvas (`current_graph`) plus a persistent `conversation_id` to
 * `/workflow-copilot`; the backend threads compressed memory and returns a full
 * amended graph.
 *
 * UX (Cursor-style generate → review → apply):
 * - Generation does NOT auto-apply. The proposed graph is held as `pending` on
 *   the assistant message; the user clicks **Apply** to write it to the canvas.
 * - **Apply** snapshots the current graph first so **Undo** can restore it.
 * - **Retry** re-runs the same instruction to get a new proposal.
 * - Conversations are managed via a header row (switch / new / delete) and
 *   persisted server-side (workflow_copilot_* tables).
 * - Context: a bar above the input lists every node in the conversation
 *   context. Nodes are added from a node's "..." menu or by typing `#` in the
 *   input (code-editor style picker); each add also inserts a soft `【Title】`
 *   mention into the draft. Chips are clickable (selects the node on canvas)
 *   and removable. The store (`copilotContextNodes`) is the source of truth.
 */

type PendingProposal = {
  graph: CopilotGraph
  instruction: string
  // Node ids the backend flagged with residual reference errors. The proposal
  // can still be applied; these are highlighted on the canvas so the user
  // knows exactly which nodes to fix.
  warningNodeIds?: string[]
}

type CopilotMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  // Assistant-only: proposed graph awaiting Apply, and whether it was applied.
  pending?: PendingProposal
  applied?: boolean
  // Assistant-only: wall-clock generation time + real token cost of the turn,
  // shown as a meta line under the bubble. `cancelled` marks a turn the user
  // interrupted with Stop.
  durationMs?: number
  usage?: CopilotUsage
  cancelled?: boolean
}

// The generation phases we cycle through in the live indicator. The backend is
// a single request (not streamed), so these are an *estimated* progression —
// timed rotation, not real stage callbacks — purely to make the wait feel alive.
type GenPhase = 'planning' | 'building' | 'validating'
const GEN_PHASES: GenPhase[] = ['planning', 'building', 'validating']
// Advance to the next phase label on this cadence while a turn is in flight.
const GEN_PHASE_INTERVAL_MS = 2500

const FE_TIMEOUT_MS = 90_000

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Human-readable elapsed time: sub-minute in seconds (one decimal), else m:ss.
const formatDuration = (ms: number): string => {
  const totalSeconds = ms / 1000
  if (totalSeconds < 60)
    return `${totalSeconds.toFixed(1)}s`
  const m = Math.floor(totalSeconds / 60)
  const s = Math.round(totalSeconds % 60)
  return `${m}m ${s}s`
}

const isAbortError = (e: unknown): boolean =>
  (e instanceof DOMException || e instanceof Error) && e.name === 'AbortError'

// A soft node mention is written into the draft/message as 【Title】. This
// splits a string into alternating plain-text and mention segments so both the
// chat bubbles and the input overlay can render the mentions with emphasis.
type MentionSegment = { text: string, isMention: boolean }
const MENTION_RE = /【[^】]+】/g

const splitMentions = (text: string): MentionSegment[] => {
  const segments: MentionSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(MENTION_RE)) {
    const start = match.index ?? 0
    if (start > lastIndex)
      segments.push({ text: text.slice(lastIndex, start), isMention: false })
    segments.push({ text: match[0], isMention: true })
    lastIndex = start + match[0].length
  }
  if (lastIndex < text.length)
    segments.push({ text: text.slice(lastIndex), isMention: false })
  return segments
}

// The set of node titles currently mentioned in the draft (the text inside each
// 【…】). Used to keep the context chips in sync when the user edits the draft.
const mentionedTitlesIn = (text: string): Set<string> => {
  const titles = new Set<string>()
  for (const match of text.matchAll(MENTION_RE))
    titles.add(match[0].slice(1, -1)) // strip the 【 】 brackets
  return titles
}

// Remove every 【title】 occurrence for the given title from a draft string.
const stripMention = (text: string, title: string): string =>
  text.split(`【${title}】`).join('').replace(/ {2,}/g, ' ').trimStart()

// Render a string with 【Title】 mentions highlighted as inline pills.
//  - 'bubble-user'/'bubble-assistant': chat history; each picks a pill style
//    that reads clearly on that bubble's background.
//  - 'overlay': the transparent layer behind the textarea — the REAL text comes
//    from the textarea on top, so we only paint the pill background and MUST NOT
//    add horizontal padding/margin or the block would drift off the glyphs.
type MentionVariant = 'bubble-user' | 'bubble-assistant' | 'overlay'

const MENTION_PILL_CLASS: Record<MentionVariant, string> = {
  // On the blue user bubble: translucent white pill + white text — high contrast.
  'bubble-user': 'mx-px inline-flex items-center rounded-md bg-white/25 px-1.5 py-px font-medium text-white',
  // On the grey assistant bubble: accent-tinted pill + accent text.
  'bubble-assistant': 'mx-px inline-flex items-center rounded-md bg-state-accent-active px-1.5 py-px font-medium text-text-accent',
  // Behind the textarea: just the rounded background block (text is transparent).
  'overlay': 'rounded-[5px] bg-state-accent-hover',
}

const renderMentionSegments = (text: string, variant: MentionVariant) =>
  splitMentions(text).map((seg, i) => {
    // Segments are a deterministic split of one string; index+text is stable.
    const key = `${i}-${seg.text}`
    if (!seg.isMention)
      return <span key={key}>{seg.text}</span>
    // Strip the 【 】 brackets for bubble pills; keep them in the overlay so its
    // width matches the textarea's literal 【…】 glyphs exactly.
    const label = variant === 'overlay' ? seg.text : seg.text.slice(1, -1)
    return <span key={key} className={MENTION_PILL_CLASS[variant]}>{label}</span>
  })

const CopilotChat: FC = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const { getNodesReadOnly } = useNodesReadOnly()
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)
  const appId = useAppStore(s => s.appDetail?.id)
  const { handleNodeSelect } = useNodesInteractions()

  // Context nodes pinned from a node's "..." menu, shared via the workflow store.
  const pinnedNodes = useWorkflowStore(s => s.copilotContextNodes)
  const addCopilotContextNode = useWorkflowStore(s => s.addCopilotContextNode)
  const removeCopilotContextNode = useWorkflowStore(s => s.removeCopilotContextNode)
  const clearCopilotContextNodes = useWorkflowStore(s => s.clearCopilotContextNodes)

  // Live canvas nodes → the `#` mention picker and chip titles read from here.
  const liveNodes = useReactFlowNodes<CommonNodeType>()

  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [conversations, setConversations] = useState<CopilotConversation[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)

  // Live-generation indicator: the estimated phase label + a ticking elapsed
  // clock so the wait feels dynamic. Both reset when a turn starts/ends.
  const [genPhase, setGenPhase] = useState<GenPhase>('planning')
  const [genElapsedMs, setGenElapsedMs] = useState(0)
  // Wall-clock start of the in-flight turn, used to stamp the message duration.
  const genStartRef = useRef<number>(0)
  const phaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // `#` mention picker: open state, current filter query (text after the `#`),
  // and the keyboard-highlighted candidate index.
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Transparent highlight layer behind the textarea; kept scroll-synced so the
  // 【mention】 background blocks line up with the (transparent-bg) textarea text.
  const overlayRef = useRef<HTMLDivElement>(null)
  // True while an IME (e.g. Chinese pinyin) is composing — Enter must NOT send.
  const composingRef = useRef(false)
  // Pinned node ids already inserted as a 【Title】 mention, so we don't duplicate
  // when the same node is added again from the "..." menu.
  const mentionedIdsRef = useRef<Set<string>>(new Set())

  // Snapshot of the canvas taken right before an Apply, keyed by message id, so
  // Undo can restore the exact pre-apply graph for that specific proposal.
  const undoSnapshotRef = useRef<Record<string, CopilotGraph>>({})
  const abortRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timedOutRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  // Stop the live-generation phase/elapsed tickers (used on completion, abort,
  // and unmount). Idempotent.
  const stopGenTickers = useCallback(() => {
    if (phaseTimerRef.current) {
      clearInterval(phaseTimerRef.current)
      phaseTimerRef.current = null
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }, [])

  // Start the estimated-phase rotation + elapsed clock for a fresh turn.
  const startGenTickers = useCallback(() => {
    stopGenTickers()
    genStartRef.current = Date.now()
    setGenPhase('planning')
    setGenElapsedMs(0)
    let phaseIndex = 0
    phaseTimerRef.current = setInterval(() => {
      // Rotate up to the last phase and hold there (never wrap back to planning).
      phaseIndex = Math.min(phaseIndex + 1, GEN_PHASES.length - 1)
      setGenPhase(GEN_PHASES[phaseIndex] ?? 'validating')
    }, GEN_PHASE_INTERVAL_MS)
    elapsedTimerRef.current = setInterval(() => {
      setGenElapsedMs(Date.now() - genStartRef.current)
    }, 100)
  }, [stopGenTickers])

  // Clean up tickers if the panel unmounts mid-generation.
  useEffect(() => stopGenTickers, [stopGenTickers])

  // ── Conversation management ────────────────────────────────────────────
  const refreshConversations = useCallback(() => {
    if (!appId)
      return
    listCopilotConversations(appId)
      .then(res => setConversations(res?.conversations || []))
      .catch(() => { /* non-fatal: list is best-effort */ })
  }, [appId])

  const loadConversation = useCallback((id: string) => {
    fetchCopilotMessages(id)
      .then((res) => {
        setConversationId(res.conversation_id)
        setMessages((res.messages || []).map(m => ({ id: m.id, role: m.role, content: m.content })))
        if (appId)
          window.sessionStorage.setItem(`workflow-copilot-conv:${appId}`, res.conversation_id)
      })
      .catch(() => { /* stale id: ignore */ })
  }, [appId])

  // On mount: list conversations and resume the last-used one for this app.
  useEffect(() => {
    if (!appId)
      return
    refreshConversations()
    const stored = window.sessionStorage.getItem(`workflow-copilot-conv:${appId}`)
    if (stored)
      loadConversation(stored)
  }, [appId, refreshConversations, loadConversation])

  const handleNewConversation = useCallback(() => {
    setConversationId(null)
    setMessages([])
    setInput('')
    clearCopilotContextNodes()
    mentionedIdsRef.current.clear()
    setMentionOpen(false)
    if (appId)
      window.sessionStorage.removeItem(`workflow-copilot-conv:${appId}`)
  }, [appId, clearCopilotContextNodes])

  const handleSwitchConversation = useCallback((id: string) => {
    if (!id) {
      handleNewConversation()
      return
    }
    loadConversation(id)
  }, [handleNewConversation, loadConversation])

  const handleDeleteConversation = useCallback(() => {
    if (!conversationId)
      return
    const deletingId = conversationId
    deleteCopilotConversation(deletingId)
      .then(() => {
        setConversations(prev => prev.filter(c => c.id !== deletingId))
        handleNewConversation()
      })
      .catch(() => {
        toast.error(t('workflow.workflowGenerator.generateFailed', { defaultValue: 'Failed to delete conversation' }))
      })
  }, [conversationId, handleNewConversation, t])

  // ── Context nodes + `#` mention ─────────────────────────────────────────
  // The store (copilotContextNodes) is the source of truth for what's in
  // context; the input's 【Title】 mentions are a soft, human-readable echo.

  // Append a soft 【Title】 mention to the end of the draft. Used only when a
  // node is added from its "..." menu (there's no meaningful caret then).
  const appendMentionText = useCallback((title: string) => {
    const token = `【${title}】`
    setInput(prev => prev ? `${prev} ${token}` : token)
  }, [])

  // Chip click → locate/select the node on the canvas so the user can jump to
  // it. Context membership is unaffected (removal is a separate button).
  const handleChipClick = useCallback((id: string) => {
    handleNodeSelect(id)
  }, [handleNodeSelect])

  // Remove a context chip → also strip its 【Title】 mention(s) from the draft
  // so the two stay in sync (delete-chip → mention disappears).
  const handleRemovePinned = useCallback((id: string) => {
    const removed = pinnedNodes.find(n => n.id === id)
    removeCopilotContextNode(id)
    mentionedIdsRef.current.delete(id)
    if (removed)
      setInput(prev => stripMention(prev, removed.title))
  }, [pinnedNodes, removeCopilotContextNode])

  // Reverse sync: when the user edits the draft and a pinned node's 【Title】 is
  // no longer present anywhere in the text, drop that context chip too
  // (delete-mention → chip disappears).
  const syncChipsFromDraft = useCallback((value: string) => {
    const present = mentionedTitlesIn(value)
    for (const node of pinnedNodes) {
      if (!present.has(node.title)) {
        removeCopilotContextNode(node.id)
        mentionedIdsRef.current.delete(node.id)
      }
    }
  }, [pinnedNodes, removeCopilotContextNode])

  // Nodes added from a node's "..." menu land in the store first; mirror each
  // new one into the draft as a 【Title】 mention. Deferred out of the effect
  // body (rAF) so the setState isn't a synchronous cascade.
  useEffect(() => {
    const additions = pinnedNodes.filter(n => !mentionedIdsRef.current.has(n.id))
    if (additions.length === 0)
      return
    for (const n of additions)
      mentionedIdsRef.current.add(n.id)
    const raf = requestAnimationFrame(() => {
      for (const n of additions)
        appendMentionText(n.title)
    })
    return () => cancelAnimationFrame(raf)
  }, [pinnedNodes, appendMentionText])

  // Candidate nodes for the `#` picker, filtered by the text typed after `#`.
  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase()
    return liveNodes
      .map(n => ({ id: n.id, title: n.data?.title || n.data?.type || n.id }))
      .filter(n => !q || n.title.toLowerCase().includes(q))
      .slice(0, 8)
  }, [liveNodes, mentionQuery])

  // Detect a `#` immediately before the caret to open the picker, and keep the
  // query in sync as the user types after it.
  const syncMentionState = useCallback((value: string, caret: number) => {
    const hashIdx = value.lastIndexOf('#', caret - 1)
    if (hashIdx === -1) {
      setMentionOpen(false)
      return
    }
    const between = value.slice(hashIdx + 1, caret)
    // Only an unbroken run of non-space/newline chars right after `#` counts.
    if (/[\s【】]/.test(between)) {
      setMentionOpen(false)
      return
    }
    setMentionQuery(between)
    setMentionOpen(true)
    setMentionActiveIndex(0)
  }, [])

  // Pick a node from the `#` menu: replace the `#query` with 【Title】 + context.
  const handlePickMention = useCallback((node: { id: string, title: string }) => {
    const el = inputRef.current
    setInput((prev) => {
      const caret = el?.selectionStart ?? prev.length
      const hashIdx = prev.lastIndexOf('#', caret - 1)
      if (hashIdx === -1)
        return prev
      const token = `【${node.title}】`
      const next = `${prev.slice(0, hashIdx)}${token}${prev.slice(caret)}`
      requestAnimationFrame(() => {
        const pos = hashIdx + token.length
        el?.focus()
        el?.setSelectionRange(pos, pos)
      })
      return next
    })
    addCopilotContextNode({ id: node.id, title: node.title })
    mentionedIdsRef.current.add(node.id)
    setMentionOpen(false)
  }, [addCopilotContextNode])

  // ── Generation ─────────────────────────────────────────────────────────
  const runGeneration = useCallback(async (instruction: string, retryOfMessageId?: string) => {
    if (getNodesReadOnly()) {
      toast.error(t('workflow.common.workflowProcessing', { defaultValue: 'Canvas is read-only right now' }))
      return
    }
    if (!defaultModel) {
      toast.error(t('workflow.workflowGenerator.noModel', { defaultValue: 'Please configure a default LLM in Settings → Model Provider first.' }))
      return
    }
    if (!appId) {
      toast.error(t('workflow.workflowGenerator.generateFailed', { defaultValue: 'Generation failed' }))
      return
    }

    setIsGenerating(true)
    startGenTickers()

    const { getNodes, edges, transform } = store.getState()
    const nodes = getNodes()
    const currentGraph: CopilotGraph | undefined = nodes.length > 0
      ? {
          nodes: nodes as Node[],
          edges: edges as Edge[],
          viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
        }
      : undefined

    // Pinned node ids are sent as structured context; the backend resolves
    // them to full node structure and appends to the generator instruction
    // only. The `message` we send stays exactly what the user typed, so the
    // persisted history never shows a synthetic "[Context nodes...]" line.
    const contextNodeIds = pinnedNodes.map(n => n.id)

    timeoutRef.current = setTimeout(() => {
      timedOutRef.current = true
      abortRef.current?.abort()
      abortRef.current = null
    }, FE_TIMEOUT_MS)

    try {
      const res = await generateWorkflowCopilot({
        app_id: appId,
        conversation_id: conversationId,
        mode: isChatMode ? 'advanced-chat' : 'workflow',
        message: instruction,
        model_config: {
          provider: defaultModel.provider.provider,
          name: defaultModel.model,
          mode: 'chat',
          completion_params: {},
        },
        ...(currentGraph ? { current_graph: currentGraph } : {}),
        ...(contextNodeIds.length > 0 ? { context_node_ids: contextNodeIds } : {}),
      }, {
        getAbortController: (c: AbortController) => { abortRef.current = c },
      })

      if (res.conversation_id) {
        setConversationId(res.conversation_id)
        window.sessionStorage.setItem(`workflow-copilot-conv:${appId}`, res.conversation_id)
        refreshConversations()
      }

      // Wall-clock turn time + real backend token usage, stamped onto the
      // resulting assistant message so the user sees the cost of the turn.
      const durationMs = Date.now() - genStartRef.current
      const usage = res.usage

      const firstError = res.errors?.[0]
      // No usable graph at all → hard fail (surface the diagnostic).
      if (!res.graph?.nodes?.length) {
        const detail = firstError?.detail || res.error
          || t('workflow.workflowGenerator.generateFailed', { defaultValue: 'Generation failed' })
        setMessages(prev => [...prev, { id: newId(), role: 'assistant', content: detail, durationMs, usage }])
        toast.error(detail)
        return
      }

      // A graph exists but the backend flagged residual reference errors that
      // auto-repair + one retry couldn't clear. Per product decision we still
      // let the user Apply it, but warn and highlight the offending nodes so
      // they can fix them on the canvas.
      const warningNodeIds = Array.from(
        new Set((res.errors || []).map(e => e.node_id).filter((id): id is string => !!id)),
      )

      // Hold the proposal as pending; the user applies it explicitly.
      const baseReply = res.reply
        || t('workflow.workflowGenerator.proposalReady', { defaultValue: 'Proposal ready — review and Apply.' })
      const reply = warningNodeIds.length > 0
        ? `${baseReply}\n\n⚠️ ${t('workflow.workflowGenerator.residualRefWarning', {
          defaultValue: 'Some references need attention on the highlighted node(s); you can still Apply and fix them.',
        })}`
        : baseReply
      const proposal: PendingProposal = { graph: res.graph, instruction, warningNodeIds }
      if (retryOfMessageId) {
        // Replace the retried assistant message's proposal in place.
        setMessages(prev => prev.map(m =>
          m.id === retryOfMessageId ? { ...m, content: reply, pending: proposal, applied: false, durationMs, usage, cancelled: false } : m,
        ))
      }
      else {
        setMessages(prev => [...prev, { id: newId(), role: 'assistant', content: reply, pending: proposal, durationMs, usage }])
      }
    }
    catch (e: unknown) {
      if (isAbortError(e)) {
        const durationMs = Date.now() - genStartRef.current
        if (timedOutRef.current) {
          const msg = t('workflow.workflowGenerator.errors.timeout', { defaultValue: 'Generation timed out. Please try again.' })
          setMessages(prev => [...prev, { id: newId(), role: 'assistant', content: msg, durationMs }])
          toast.error(msg)
        }
        else {
          // User pressed Stop — record a cancelled turn so the timeline stays
          // honest about what happened (and how long it ran).
          const msg = t('workflow.workflowGenerator.stopped', { defaultValue: 'Generation stopped.' })
          setMessages(prev => [...prev, { id: newId(), role: 'assistant', content: msg, durationMs, cancelled: true }])
        }
        return
      }
      const message = e instanceof Error ? e.message : t('workflow.workflowGenerator.generateFailed', { defaultValue: 'Generation failed' })
      setMessages(prev => [...prev, { id: newId(), role: 'assistant', content: message }])
      toast.error(message)
    }
    finally {
      timedOutRef.current = false
      setIsGenerating(false)
      stopGenTickers()
      clearTimers()
      abortRef.current = null
    }
  }, [
    getNodesReadOnly,
    defaultModel,
    appId,
    store,
    pinnedNodes,
    conversationId,
    isChatMode,
    refreshConversations,
    clearTimers,
    startGenTickers,
    stopGenTickers,
    t,
  ])

  const handleSend = useCallback(() => {
    const instruction = input.trim()
    if (!instruction || isGenerating)
      return
    setMessages(prev => [...prev, { id: newId(), role: 'user', content: instruction }])
    setInput('')
    setMentionOpen(false)
    runGeneration(instruction)
  }, [input, isGenerating, runGeneration])

  const handleRetry = useCallback((message: CopilotMessage) => {
    if (isGenerating || !message.pending)
      return
    runGeneration(message.pending.instruction, message.id)
  }, [isGenerating, runGeneration])

  // Interrupt the in-flight turn. Aborting the request makes `runGeneration`'s
  // catch treat it as a user stop (not a timeout) and record a cancelled turn.
  const handleStop = useCallback(() => {
    if (!isGenerating)
      return
    timedOutRef.current = false
    abortRef.current?.abort()
    abortRef.current = null
  }, [isGenerating])

  // ── Apply / Undo ───────────────────────────────────────────────────────
  const applyGraph = useCallback((graph: CopilotGraph, highlightNodeIds?: string[]) => {
    const highlight = new Set(highlightNodeIds || [])
    // Select the flagged nodes so they're highlighted on the canvas, guiding
    // the user straight to the references that still need a manual fix.
    const nodes = highlight.size > 0
      ? graph.nodes.map(n => ({ ...n, data: { ...n.data, selected: highlight.has(n.id) } }))
      : graph.nodes
    handleUpdateWorkflowCanvas({
      nodes,
      edges: graph.edges,
      viewport: graph.viewport || reactflow.getViewport(),
    })
    handleSyncWorkflowDraft(true)
  }, [handleUpdateWorkflowCanvas, handleSyncWorkflowDraft, reactflow])

  const handleApply = useCallback((message: CopilotMessage) => {
    if (!message.pending || getNodesReadOnly())
      return
    // Snapshot the current canvas so this proposal's Apply can be undone.
    const { getNodes, edges, transform } = store.getState()
    undoSnapshotRef.current[message.id] = {
      nodes: getNodes() as Node[],
      edges: edges as Edge[],
      viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
    }
    applyGraph(message.pending.graph, message.pending.warningNodeIds)
    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, applied: true } : m))
  }, [getNodesReadOnly, store, applyGraph])

  const handleUndo = useCallback((message: CopilotMessage) => {
    const snapshot = undoSnapshotRef.current[message.id]
    if (!snapshot || getNodesReadOnly())
      return
    applyGraph(snapshot)
    delete undoSnapshotRef.current[message.id]
    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, applied: false } : m))
  }, [getNodesReadOnly, applyGraph])

  // Undo a whole turn: drop the assistant message and the user message that
  // triggered it (the immediately-preceding user turn). If the proposal was
  // already applied to the canvas, undo that first so nothing is left behind.
  const handleDiscardTurn = useCallback((message: CopilotMessage) => {
    if (isGenerating)
      return
    if (message.applied) {
      const snapshot = undoSnapshotRef.current[message.id]
      if (snapshot && !getNodesReadOnly())
        applyGraph(snapshot)
    }
    delete undoSnapshotRef.current[message.id]
    setMessages((prev) => {
      const idx = prev.findIndex(m => m.id === message.id)
      if (idx === -1)
        return prev
      // Also remove the user turn directly above this assistant message.
      const dropUser = idx > 0 && prev[idx - 1]?.role === 'user'
      const from = dropUser ? idx - 1 : idx
      return [...prev.slice(0, from), ...prev.slice(idx + 1)]
    })
  }, [isGenerating, getNodesReadOnly, applyGraph])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // While the `#` picker is open, arrows/Enter/Tab drive the list, not send.
    if (mentionOpen && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionActiveIndex(i => (i + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionActiveIndex(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const picked = mentionCandidates[mentionActiveIndex] ?? mentionCandidates[0]
        if (picked)
          handlePickMention(picked)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionOpen(false)
        return
      }
    }
    // IME (e.g. Chinese pinyin) composing: Enter commits the candidate, it must
    // NOT send the message. `composingRef` tracks compositionstart/end and
    // `isComposing` is the belt-and-braces guard for the terminal keystroke.
    if (e.key === 'Enter' && !e.shiftKey) {
      if (composingRef.current || e.nativeEvent.isComposing)
        return
      e.preventDefault()
      handleSend()
    }
  }, [mentionOpen, mentionCandidates, mentionActiveIndex, handlePickMention, handleSend])

  return (
    <div className="flex h-full flex-col">
      {/* Conversation management row */}
      <div className="flex shrink-0 items-center gap-2 border-b border-divider-subtle px-3 py-2">
        <select
          className="min-w-0 grow rounded-md border border-divider-regular bg-components-input-bg-normal px-2 py-1 system-xs-regular text-text-secondary outline-none"
          value={conversationId || ''}
          onChange={e => handleSwitchConversation(e.target.value)}
        >
          <option value="">{t('workflow.workflowGenerator.newConversation', { defaultValue: 'New conversation' })}</option>
          {conversations.map(c => (
            <option key={c.id} value={c.id}>
              {c.title || `${t('workflow.workflowGenerator.conversation', { defaultValue: 'Conversation' })} ${c.id.slice(0, 6)}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={t('workflow.workflowGenerator.newConversation', { defaultValue: 'New conversation' })}
          className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-state-base-hover"
          onClick={handleNewConversation}
        >
          <RiAddLine className="size-4 text-text-tertiary" />
        </button>
        {conversationId && (
          <button
            type="button"
            aria-label={t('common.operation.delete', { defaultValue: 'Delete' })}
            className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-state-destructive-hover"
            onClick={handleDeleteConversation}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary" />
          </button>
        )}
      </div>

      <div className="grow space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <RiSparkling2Line className="size-7 text-text-quaternary" />
            <p className="system-sm-regular text-text-tertiary">
              {t('workflow.workflowGenerator.copilotHint', { defaultValue: 'Describe the workflow you want. I will build the nodes on the canvas.' })}
            </p>
          </div>
        )}
        {messages.map(m => (
          <div
            key={m.id}
            className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start gap-1.5'}
          >
            <div
              className={m.role === 'user'
                ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-components-button-primary-bg px-3 py-2 system-sm-regular whitespace-pre-wrap text-components-button-primary-text'
                : m.cancelled
                  ? 'max-w-[85%] rounded-2xl rounded-bl-sm bg-components-panel-on-panel-item-bg px-3 py-2 system-sm-regular whitespace-pre-wrap text-text-tertiary italic'
                  : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-components-panel-on-panel-item-bg px-3 py-2 system-sm-regular whitespace-pre-wrap text-text-secondary'}
            >
              {renderMentionSegments(m.content, m.role === 'user' ? 'bubble-user' : 'bubble-assistant')}
            </div>
            {/* Apply / Retry / Undo / Discard actions for assistant proposals */}
            {m.role === 'assistant' && m.pending && (
              <div className="flex items-center gap-1.5">
                {!m.applied
                  ? (
                      <Button size="small" variant="primary" disabled={isGenerating} onClick={() => handleApply(m)}>
                        <RiCheckLine className="mr-1 size-3.5" />
                        {t('workflow.workflowGenerator.apply', { defaultValue: 'Apply' })}
                      </Button>
                    )
                  : (
                      <Button size="small" variant="secondary" disabled={isGenerating} onClick={() => handleUndo(m)}>
                        <RiArrowGoBackLine className="mr-1 size-3.5" />
                        {t('workflow.workflowGenerator.undo', { defaultValue: 'Undo' })}
                      </Button>
                    )}
                <Button size="small" variant="ghost" disabled={isGenerating} onClick={() => handleRetry(m)}>
                  <RiRefreshLine className="mr-1 size-3.5" />
                  {t('workflow.workflowGenerator.retry', { defaultValue: 'Retry' })}
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={isGenerating}
                  title={t('workflow.workflowGenerator.discardTurn', { defaultValue: 'Discard this turn' })}
                  onClick={() => handleDiscardTurn(m)}
                >
                  <RiDeleteBinLine className="size-3.5" />
                </Button>
              </div>
            )}
            {/* Meta line: wall-clock time + real token usage for the turn. */}
            {m.role === 'assistant' && (m.durationMs !== undefined || m.usage) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 system-2xs-regular text-text-quaternary">
                {m.durationMs !== undefined && (
                  <span>
                    {t('workflow.workflowGenerator.tookTime', { defaultValue: 'Took' })}
                    {' '}
                    {formatDuration(m.durationMs)}
                  </span>
                )}
                {m.usage && (
                  <span>
                    ·
                    {' '}
                    {m.usage.total_tokens}
                    {' '}
                    {t('workflow.workflowGenerator.tokens', { defaultValue: 'tokens' })}
                    {' '}
                    (
                    {m.usage.prompt_tokens}
                    {' '}
                    +
                    {' '}
                    {m.usage.completion_tokens}
                    )
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
        {isGenerating && (
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-components-panel-on-panel-item-bg px-3 py-2 system-sm-regular text-text-tertiary">
              <RiSparkling2Line className="size-4 animate-pulse text-text-accent" />
              <span>
                {t(`workflow.workflowGenerator.phases.${genPhase}`, {
                  defaultValue: genPhase === 'planning'
                    ? 'Planning the workflow…'
                    : genPhase === 'building' ? 'Building nodes…' : 'Validating the graph…',
                })}
              </span>
              <span className="text-text-quaternary tabular-nums">{formatDuration(genElapsedMs)}</span>
            </div>
            <Button size="small" variant="ghost" onClick={handleStop}>
              <RiStopCircleLine className="mr-1 size-3.5" />
              {t('workflow.workflowGenerator.stop', { defaultValue: 'Stop' })}
            </Button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-divider-subtle p-3">
        {/* Context nodes pinned from a node's "..." menu ("Add to Copilot") */}
        {pinnedNodes.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="system-2xs-medium-uppercase text-text-tertiary">
              {t('workflow.workflowGenerator.contextNodes', { defaultValue: 'Context' })}
            </span>
            {pinnedNodes.map(chip => (
              <span
                key={chip.id}
                className="flex max-w-[140px] items-center gap-1 rounded-md bg-state-accent-hover px-1.5 py-0.5 system-2xs-medium text-text-accent"
              >
                <button
                  type="button"
                  className="truncate hover:underline"
                  title={t('workflow.workflowGenerator.locateNode', { defaultValue: 'Locate node on canvas' })}
                  onClick={() => handleChipClick(chip.id)}
                >
                  {chip.title}
                </button>
                <button type="button" aria-label="remove" onClick={() => handleRemovePinned(chip.id)}>
                  <span aria-hidden className="i-ri-close-line size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          {/* `#` mention picker — code-editor style. Opens when the caret sits
              right after a `#`; picking a node inserts a 【Title】 mention and
              adds it to context. */}
          {mentionOpen && mentionCandidates.length > 0 && (
            <div className="absolute bottom-full left-0 z-10 mb-1 max-h-52 w-full overflow-y-auto rounded-lg border border-components-panel-border bg-components-panel-bg py-1 shadow-lg">
              {mentionCandidates.map((node, i) => (
                <button
                  key={node.id}
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left system-sm-regular ${
                    i === mentionActiveIndex ? 'bg-state-base-hover text-text-primary' : 'text-text-secondary'
                  }`}
                  onMouseEnter={() => setMentionActiveIndex(i)}
                  onMouseDown={(e) => {
                    // mousedown (not click) so the textarea keeps focus/caret.
                    e.preventDefault()
                    handlePickMention(node)
                  }}
                >
                  <span className="truncate">{node.title}</span>
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            {/* Transparent highlight layer: same geometry as the textarea, but
                only the 【mention】 spans paint a background. The textarea sits
                on top with a transparent background so its real (opaque) text
                shows while the blocks below line up glyph-for-glyph. */}
            <div
              ref={overlayRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent bg-components-input-bg-normal p-2 system-sm-regular break-words whitespace-pre-wrap text-transparent"
            >
              {renderMentionSegments(input, 'overlay')}
              {/* trailing newline so the last line's height matches the textarea */}
              {'\n'}
            </div>
            <textarea
              ref={inputRef}
              className="relative z-[1] min-h-[60px] w-full resize-none rounded-lg border border-divider-regular bg-transparent p-2 system-sm-regular break-words whitespace-pre-wrap text-text-primary outline-none focus:border-components-input-border-active"
              placeholder={t('workflow.workflowGenerator.copilotPlaceholder', { defaultValue: 'e.g. Add an LLM node that summarizes the input… (type # to mention a node)' })}
              value={input}
              disabled={isGenerating}
              onChange={(e) => {
                setInput(e.target.value)
                syncMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length)
                syncChipsFromDraft(e.target.value)
              }}
              onScroll={(e) => {
                // Keep the highlight layer aligned when the textarea scrolls.
                if (overlayRef.current)
                  overlayRef.current.scrollTop = e.currentTarget.scrollTop
              }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => { composingRef.current = false }}
            />
          </div>
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            variant="primary"
            disabled={isGenerating || input.trim().length === 0}
            onClick={handleSend}
          >
            {t('workflow.workflowGenerator.generate', { defaultValue: 'Generate' })}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CopilotChat
