import type { FC } from 'react'
import type { CommonNodeType, Edge, Node } from '../../types'
import type { MentionInputHandle, MentionNode } from './mention-input'
import type { CopilotConversation, CopilotGraph } from './service'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import {
  RiAddLine,
  RiArrowGoBackLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiRefreshLine,
  RiSparkling2Line,
  RiStopCircleLine,
} from '@remixicon/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow, useNodes as useReactFlowNodes, useStoreApi } from 'reactflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useStore as useWorkflowStore } from '@/app/components/workflow/store'
import { useNodesInteractions } from '../../hooks/use-nodes-interactions'
import { useNodesSyncDraft } from '../../hooks/use-nodes-sync-draft'
import { useIsChatMode, useNodesReadOnly } from '../../hooks/use-workflow'
import { useWorkflowUpdate } from '../../hooks/use-workflow-update'
import { BlockEnum } from '../../types'
import MentionInput from './mention-input'
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
  // Assistant-only: wall-clock generation time of the turn, shown as a meta
  // line under the bubble. `cancelled` marks a turn the user interrupted with
  // Stop.
  durationMs?: number
  cancelled?: boolean
}

const FE_TIMEOUT_MS = 90_000

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Human-readable elapsed time: sub-minute in seconds (one decimal), else m:ss.
const formatDuration = (ms: number): string => {
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  const m = Math.floor(totalSeconds / 60)
  const s = Math.round(totalSeconds % 60)
  return `${m}m ${s}s`
}

// Conversation dropdown label. Prefer a server-set title; otherwise show the
// last-updated time (MM-DD HH:mm) — far friendlier than the old id fragment.
const formatConversationLabel = (title: string, updatedAt: number): string => {
  if (title) return title
  const d = new Date(updatedAt * 1000) // backend sends seconds
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const isAbortError = (e: unknown): boolean =>
  (e instanceof DOMException || e instanceof Error) && e.name === 'AbortError'

// A node mention is written into the message as 【Title】. This splits a string
// into alternating plain-text and mention segments so the chat bubbles can
// render each mention as an inline pill (matching the input's node bubbles).
type MentionSegment = { text: string; isMention: boolean }
const MENTION_RE = /【[^】]+】/g

const splitMentions = (text: string): MentionSegment[] => {
  const segments: MentionSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(MENTION_RE)) {
    const start = match.index ?? 0
    if (start > lastIndex) segments.push({ text: text.slice(lastIndex, start), isMention: false })
    segments.push({ text: match[0], isMention: true })
    lastIndex = start + match[0].length
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), isMention: false })
  return segments
}

// Render a string with 【Title】 mentions as inline node pills. The two variants
// pick a pill style that reads clearly on each chat bubble's background.
type MentionVariant = 'bubble-user' | 'bubble-assistant'

const MENTION_PILL_CLASS: Record<MentionVariant, string> = {
  // On the blue user bubble: translucent white bordered pill + white text.
  'bubble-user':
    'mx-0.5 inline-flex items-center gap-0.5 rounded-md border-[0.5px] border-white/40 bg-white/20 px-1 py-px align-middle font-medium text-white',
  // On the grey assistant bubble: light bordered badge (matches the input pill).
  'bubble-assistant':
    'mx-0.5 inline-flex items-center gap-0.5 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark px-1 py-px align-middle font-medium text-text-secondary shadow-xs',
}

const MENTION_ICON_CLASS: Record<MentionVariant, string> = {
  'bubble-user': 'i-ri-hashtag size-3 shrink-0 text-white/80',
  'bubble-assistant': 'i-ri-hashtag size-3 shrink-0 text-text-accent',
}

const renderMentionSegments = (text: string, variant: MentionVariant) =>
  splitMentions(text).map((seg, i) => {
    // Segments are a deterministic split of one string; index+text is stable.
    const key = `${i}-${seg.text}`
    if (!seg.isMention) return <span key={key}>{seg.text}</span>
    return (
      <span key={key} className={MENTION_PILL_CLASS[variant]}>
        <span aria-hidden className={MENTION_ICON_CLASS[variant]} />
        {seg.text.slice(1, -1)}
      </span>
    )
  })

const CopilotChat: FC = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const { getNodesReadOnly } = useNodesReadOnly()
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(
    ModelTypeEnum.textGeneration,
  )
  const appId = useAppStore((s) => s.appDetail?.id)
  const { handleNodeSelect } = useNodesInteractions()

  // Context nodes pinned from a node's "..." menu, shared via the workflow store.
  const pinnedNodes = useWorkflowStore((s) => s.copilotContextNodes)
  const addCopilotContextNode = useWorkflowStore((s) => s.addCopilotContextNode)
  const removeCopilotContextNode = useWorkflowStore((s) => s.removeCopilotContextNode)
  const clearCopilotContextNodes = useWorkflowStore((s) => s.clearCopilotContextNodes)

  // Live canvas nodes → the `#` mention picker and chip titles read from here.
  const liveNodes = useReactFlowNodes<CommonNodeType>()

  const [messages, setMessages] = useState<CopilotMessage[]>([])
  // Serialized draft (plain text with 【Title】 mention tokens). The rich
  // MentionInput owns the actual DOM/caret; we keep this mirror for send + the
  // Generate button's enabled state.
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [conversations, setConversations] = useState<CopilotConversation[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  // Id of the assistant turn whose trash button is "armed" — discarding a turn
  // is destructive (drops the user + assistant messages, undoes any applied
  // graph), so the first click asks for confirmation instead of deleting.
  const [confirmingDiscardId, setConfirmingDiscardId] = useState<string | null>(null)

  // Live-generation indicator: a ticking elapsed clock so the wait feels
  // responsive. (No fake phase labels — the backend is a single request.)
  const [genElapsedMs, setGenElapsedMs] = useState(0)
  // Wall-clock start of the in-flight turn, used to stamp the message duration.
  const genStartRef = useRef<number>(0)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // `#` mention picker: open state, current filter query (text after the `#`),
  // and the keyboard-highlighted candidate index.
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  // Imperative handle to the rich input (insert/remove pills, focus, clear).
  const inputRef = useRef<MentionInputHandle>(null)
  // Node ids currently rendered as a mention pill in the input, so the "..."
  // menu additions don't duplicate an existing pill.
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

  // Stop the elapsed-time ticker (used on completion, abort, and unmount).
  // Idempotent.
  const stopGenTickers = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }, [])

  // Start the elapsed clock for a fresh turn. We show a single "generating"
  // line plus this wall-clock timer — no fake phase labels, since the backend
  // is one opaque request.
  const startGenTickers = useCallback(() => {
    stopGenTickers()
    genStartRef.current = Date.now()
    setGenElapsedMs(0)
    elapsedTimerRef.current = setInterval(() => {
      setGenElapsedMs(Date.now() - genStartRef.current)
    }, 100)
  }, [stopGenTickers])

  // Clean up tickers if the panel unmounts mid-generation.
  useEffect(() => stopGenTickers, [stopGenTickers])

  // ── Conversation management ────────────────────────────────────────────
  const refreshConversations = useCallback(() => {
    if (!appId) return
    listCopilotConversations(appId)
      .then((res) => setConversations(res?.conversations || []))
      .catch(() => {
        /* non-fatal: list is best-effort */
      })
  }, [appId])

  const loadConversation = useCallback(
    (id: string) => {
      fetchCopilotMessages(id)
        .then((res) => {
          setConversationId(res.conversation_id)
          setMessages(
            (res.messages || []).map((m) => ({ id: m.id, role: m.role, content: m.content })),
          )
          if (appId)
            window.sessionStorage.setItem(`workflow-copilot-conv:${appId}`, res.conversation_id)
        })
        .catch(() => {
          /* stale id: ignore */
        })
    },
    [appId],
  )

  // On mount: list conversations and resume the last-used one for this app.
  useEffect(() => {
    if (!appId) return
    refreshConversations()
    const stored = window.sessionStorage.getItem(`workflow-copilot-conv:${appId}`)
    if (stored) loadConversation(stored)
  }, [appId, refreshConversations, loadConversation])

  const handleNewConversation = useCallback(() => {
    setConversationId(null)
    setMessages([])
    setInput('')
    inputRef.current?.clear()
    clearCopilotContextNodes()
    mentionedIdsRef.current.clear()
    setMentionOpen(false)
    if (appId) window.sessionStorage.removeItem(`workflow-copilot-conv:${appId}`)
  }, [appId, clearCopilotContextNodes])

  const handleSwitchConversation = useCallback(
    (id: string) => {
      if (!id) {
        handleNewConversation()
        return
      }
      loadConversation(id)
    },
    [handleNewConversation, loadConversation],
  )

  const handleDeleteConversation = useCallback(() => {
    if (!conversationId) return
    const deletingId = conversationId
    deleteCopilotConversation(deletingId)
      .then(() => {
        setConversations((prev) => prev.filter((c) => c.id !== deletingId))
        handleNewConversation()
      })
      .catch(() => {
        toast.error(t(($) => $['workflowGenerator.generateFailed'], { ns: 'workflow' }))
      })
  }, [conversationId, handleNewConversation, t])

  // ── Context nodes + `#` mention ─────────────────────────────────────────
  // The store (copilotContextNodes) is the source of truth for what's in
  // context; the input's 【Title】 mentions are a soft, human-readable echo.

  // Serialized draft + mention ids reported by the rich input on every edit.
  // We mirror the text (for send / button state) and reconcile context chips
  // against the pill set: any pinned node whose pill was deleted drops its chip
  // (delete-pill → chip disappears), all keyed by node id.
  const handleInputChange = useCallback(
    (text: string, mentionIds: string[]) => {
      setInput(text)
      mentionedIdsRef.current = new Set(mentionIds)
      const present = new Set(mentionIds)
      for (const node of pinnedNodes) {
        if (!present.has(node.id)) removeCopilotContextNode(node.id)
      }
    },
    [pinnedNodes, removeCopilotContextNode],
  )

  // Chip click → locate/select the node on the canvas so the user can jump to
  // it. Context membership is unaffected (removal is a separate button).
  const handleChipClick = useCallback(
    (id: string) => {
      handleNodeSelect(id)
    },
    [handleNodeSelect],
  )

  // Remove a context chip → also remove its pill from the input by id so the
  // two stay in sync (delete-chip → pill disappears).
  const handleRemovePinned = useCallback(
    (id: string) => {
      removeCopilotContextNode(id)
      mentionedIdsRef.current.delete(id)
      inputRef.current?.removeMention(id)
    },
    [removeCopilotContextNode],
  )

  // Nodes added from a node's "..." menu land in the store first; mirror each
  // new one into the input as a pill (appended at the end — no caret context).
  useEffect(() => {
    const additions = pinnedNodes.filter((n) => !mentionedIdsRef.current.has(n.id))
    if (additions.length === 0) return
    for (const n of additions) mentionedIdsRef.current.add(n.id)
    const raf = requestAnimationFrame(() => {
      for (const n of additions) inputRef.current?.appendMention({ id: n.id, title: n.title })
    })
    return () => cancelAnimationFrame(raf)
  }, [pinnedNodes])

  // Candidate nodes for the `#` picker, filtered by the text typed after `#`.
  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase()
    return liveNodes
      .map((n) => ({ id: n.id, title: n.data?.title || n.data?.type || n.id }))
      .filter((n) => !q || n.title.toLowerCase().includes(q))
      .slice(0, 8)
  }, [liveNodes, mentionQuery])

  // The rich input reports the active `#`-query (or null when there's no live
  // trigger); open/close the picker accordingly. Only reset the highlighted
  // row when the query TEXT actually changes — otherwise the keyup that follows
  // an Arrow keydown (which also fires this via the input's onKeyUp) would snap
  // the selection back to the first row on every arrow press.
  const handleHashQueryChange = useCallback((query: string | null) => {
    if (query === null) {
      setMentionOpen(false)
      return
    }
    setMentionOpen(true)
    setMentionQuery((prev) => {
      if (prev !== query) setMentionActiveIndex(0)
      return query
    })
  }, [])

  // Pick a node from the `#` menu: the input replaces the pending `#query` with
  // a pill; we register the node as context (keyed by id).
  const handlePickMention = useCallback(
    (node: MentionNode) => {
      inputRef.current?.insertMentionAtCaret(node)
      addCopilotContextNode({ id: node.id, title: node.title })
      mentionedIdsRef.current.add(node.id)
      setMentionOpen(false)
    },
    [addCopilotContextNode],
  )

  // ── Generation ─────────────────────────────────────────────────────────
  const runGeneration = useCallback(
    async (instruction: string, retryOfMessageId?: string) => {
      if (getNodesReadOnly()) {
        toast.error(t(($) => $['common.workflowProcessing'], { ns: 'workflow' }))
        return
      }
      if (!defaultModel) {
        toast.error(t(($) => $['workflowGenerator.noModel'], { ns: 'workflow' }))
        return
      }
      if (!appId) {
        toast.error(t(($) => $['workflowGenerator.generateFailed'], { ns: 'workflow' }))
        return
      }

      setIsGenerating(true)
      startGenTickers()

      const { getNodes, edges, transform } = store.getState()
      const allNodes = getNodes()
      // A brand-new Workflow-mode app opens with a single `start-placeholder`
      // sentinel (master #37348): it's not a real node, it's the "pick a trigger
      // first" prompt. Sending it as `current_graph` would flip the backend into
      // REFINE mode and make the planner "preserve" a node type it doesn't know,
      // leaving the placeholder orphaned next to a fresh `start`. Strip it (and
      // any edge touching it) so an otherwise-empty canvas generates from scratch
      // with a real `start` node that replaces the placeholder wholesale.
      const realNodes = allNodes.filter((n) => n.data?.type !== BlockEnum.StartPlaceholder)
      const placeholderIds = new Set(
        allNodes.filter((n) => n.data?.type === BlockEnum.StartPlaceholder).map((n) => n.id),
      )
      const realEdges = (edges as Edge[]).filter(
        (e) => !placeholderIds.has(e.source) && !placeholderIds.has(e.target),
      )
      const currentGraph: CopilotGraph | undefined =
        realNodes.length > 0
          ? {
              nodes: realNodes as Node[],
              edges: realEdges,
              viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
            }
          : undefined

      // Pinned node ids are sent as structured context; the backend resolves
      // them to full node structure and appends to the generator instruction
      // only. The `message` we send stays exactly what the user typed, so the
      // persisted history never shows a synthetic "[Context nodes...]" line.
      const contextNodeIds = pinnedNodes.map((n) => n.id)

      // Own the AbortController here so both the timeout below and the Stop button
      // (handleStop) can cancel this turn; its signal is threaded into the request.
      const controller = new AbortController()
      abortRef.current = controller

      timeoutRef.current = setTimeout(() => {
        timedOutRef.current = true
        abortRef.current?.abort()
        abortRef.current = null
      }, FE_TIMEOUT_MS)

      try {
        const res = await generateWorkflowCopilot(
          {
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
          },
          {
            signal: controller.signal,
          },
        )

        if (res.conversation_id) {
          setConversationId(res.conversation_id)
          window.sessionStorage.setItem(`workflow-copilot-conv:${appId}`, res.conversation_id)
          refreshConversations()
        }

        // Wall-clock turn time, stamped onto the resulting assistant message.
        const durationMs = Date.now() - genStartRef.current

        const firstError = res.errors?.[0]
        // No usable graph at all → hard fail (surface the diagnostic).
        if (!res.graph?.nodes?.length) {
          const detail =
            firstError?.detail ||
            res.error ||
            t(($) => $['workflowGenerator.generateFailed'], { ns: 'workflow' })
          setMessages((prev) => [
            ...prev,
            { id: newId(), role: 'assistant', content: detail, durationMs },
          ])
          toast.error(detail)
          return
        }

        // A graph exists but the backend flagged residual reference errors that
        // auto-repair + one retry couldn't clear. Per product decision we still
        // let the user Apply it, but warn and highlight the offending nodes so
        // they can fix them on the canvas.
        const warningNodeIds = Array.from(
          new Set((res.errors || []).map((e) => e.node_id).filter((id): id is string => !!id)),
        )

        // Hold the proposal as pending; the user applies it explicitly.
        const baseReply =
          res.reply || t(($) => $['workflowGenerator.proposalReady'], { ns: 'workflow' })
        const reply =
          warningNodeIds.length > 0
            ? `${baseReply}\n\n⚠️ ${t(($) => $['workflowGenerator.residualRefWarning'], { ns: 'workflow' })}`
            : baseReply
        const proposal: PendingProposal = { graph: res.graph, instruction, warningNodeIds }
        if (retryOfMessageId) {
          // Replace the retried assistant message's proposal in place.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === retryOfMessageId
                ? {
                    ...m,
                    content: reply,
                    pending: proposal,
                    applied: false,
                    durationMs,
                    cancelled: false,
                  }
                : m,
            ),
          )
        } else {
          setMessages((prev) => [
            ...prev,
            { id: newId(), role: 'assistant', content: reply, pending: proposal, durationMs },
          ])
        }
      } catch (e: unknown) {
        if (isAbortError(e)) {
          const durationMs = Date.now() - genStartRef.current
          if (timedOutRef.current) {
            const msg = t(($) => $['workflowGenerator.errors.timeout'], { ns: 'workflow' })
            setMessages((prev) => [
              ...prev,
              { id: newId(), role: 'assistant', content: msg, durationMs },
            ])
            toast.error(msg)
          } else {
            // User pressed Stop — record a cancelled turn so the timeline stays
            // honest about what happened (and how long it ran).
            const msg = t(($) => $['workflowGenerator.stopped'], { ns: 'workflow' })
            setMessages((prev) => [
              ...prev,
              { id: newId(), role: 'assistant', content: msg, durationMs, cancelled: true },
            ])
          }
          return
        }
        const message =
          e instanceof Error
            ? e.message
            : t(($) => $['workflowGenerator.generateFailed'], { ns: 'workflow' })
        setMessages((prev) => [...prev, { id: newId(), role: 'assistant', content: message }])
        toast.error(message)
      } finally {
        timedOutRef.current = false
        setIsGenerating(false)
        stopGenTickers()
        clearTimers()
        abortRef.current = null
      }
    },
    [
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
    ],
  )

  const handleSend = useCallback(() => {
    const instruction = input.trim()
    if (!instruction || isGenerating) return
    setMessages((prev) => [...prev, { id: newId(), role: 'user', content: instruction }])
    setInput('')
    inputRef.current?.clear()
    mentionedIdsRef.current.clear()
    setMentionOpen(false)
    runGeneration(instruction)
  }, [input, isGenerating, runGeneration])

  const handleRetry = useCallback(
    (message: CopilotMessage) => {
      if (isGenerating || !message.pending) return
      runGeneration(message.pending.instruction, message.id)
    },
    [isGenerating, runGeneration],
  )

  // Interrupt the in-flight turn. Aborting the request makes `runGeneration`'s
  // catch treat it as a user stop (not a timeout) and record a cancelled turn.
  const handleStop = useCallback(() => {
    if (!isGenerating) return
    timedOutRef.current = false
    abortRef.current?.abort()
    abortRef.current = null
  }, [isGenerating])

  // ── Apply / Undo ───────────────────────────────────────────────────────
  const applyGraph = useCallback(
    (graph: CopilotGraph, highlightNodeIds?: string[]) => {
      const highlight = new Set(highlightNodeIds || [])
      // Select the flagged nodes so they're highlighted on the canvas, guiding
      // the user straight to the references that still need a manual fix.
      const nodes =
        highlight.size > 0
          ? graph.nodes.map((n) => ({ ...n, data: { ...n.data, selected: highlight.has(n.id) } }))
          : graph.nodes
      handleUpdateWorkflowCanvas({
        nodes,
        edges: graph.edges,
        viewport: graph.viewport || reactflow.getViewport(),
      })
      handleSyncWorkflowDraft(true)
    },
    [handleUpdateWorkflowCanvas, handleSyncWorkflowDraft, reactflow],
  )

  const handleApply = useCallback(
    (message: CopilotMessage) => {
      if (!message.pending || getNodesReadOnly()) return
      // Snapshot the current canvas so this proposal's Apply can be undone.
      const { getNodes, edges, transform } = store.getState()
      undoSnapshotRef.current[message.id] = {
        nodes: getNodes() as Node[],
        edges: edges as Edge[],
        viewport: { x: transform[0], y: transform[1], zoom: transform[2] },
      }
      applyGraph(message.pending.graph, message.pending.warningNodeIds)
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, applied: true } : m)))
    },
    [getNodesReadOnly, store, applyGraph],
  )

  const handleUndo = useCallback(
    (message: CopilotMessage) => {
      const snapshot = undoSnapshotRef.current[message.id]
      if (!snapshot || getNodesReadOnly()) return
      applyGraph(snapshot)
      delete undoSnapshotRef.current[message.id]
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, applied: false } : m)))
    },
    [getNodesReadOnly, applyGraph],
  )

  // Undo a whole turn: drop the assistant message and the user message that
  // triggered it (the immediately-preceding user turn). If the proposal was
  // already applied to the canvas, undo that first so nothing is left behind.
  const handleDiscardTurn = useCallback(
    (message: CopilotMessage) => {
      if (isGenerating) return
      setConfirmingDiscardId(null)
      if (message.applied) {
        const snapshot = undoSnapshotRef.current[message.id]
        if (snapshot && !getNodesReadOnly()) applyGraph(snapshot)
      }
      delete undoSnapshotRef.current[message.id]
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === message.id)
        if (idx === -1) return prev
        // Also remove the user turn directly above this assistant message.
        const dropUser = idx > 0 && prev[idx - 1]?.role === 'user'
        const from = dropUser ? idx - 1 : idx
        return [...prev.slice(0, from), ...prev.slice(idx + 1)]
      })
    },
    [isGenerating, getNodesReadOnly, applyGraph],
  )

  // Picker navigation, delegated from the rich input while the `#` menu is
  // open. Returns true (and preventDefaults) when it consumed the key, so the
  // input knows not to also treat Enter as "send" / insert a newline.
  const handlePickerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): boolean => {
      if (!(mentionOpen && mentionCandidates.length > 0)) return false
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionActiveIndex((i) => (i + 1) % mentionCandidates.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionActiveIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const picked = mentionCandidates[mentionActiveIndex] ?? mentionCandidates[0]
        if (picked) handlePickMention(picked)
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionOpen(false)
        return true
      }
      return false
    },
    [mentionOpen, mentionCandidates, mentionActiveIndex, handlePickMention],
  )

  return (
    <div className="flex h-full flex-col">
      {/* Conversation management row */}
      <div className="flex shrink-0 items-center gap-2 border-b border-divider-subtle px-3 py-2">
        <select
          className="min-w-0 grow rounded-md border border-divider-regular bg-components-input-bg-normal px-2 py-1 system-xs-regular text-text-secondary outline-none"
          value={conversationId || ''}
          onChange={(e) => handleSwitchConversation(e.target.value)}
        >
          <option value="">
            {t(($) => $['workflowGenerator.newConversation'], { ns: 'workflow' })}
          </option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {formatConversationLabel(c.title, c.updated_at)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={t(($) => $['workflowGenerator.newConversation'], { ns: 'workflow' })}
          className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-state-base-hover"
          onClick={handleNewConversation}
        >
          <RiAddLine className="size-4 text-text-tertiary" />
        </button>
        {conversationId && (
          <button
            type="button"
            aria-label={t(($) => $['operation.delete'], { ns: 'common' })}
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
              {t(($) => $['workflowGenerator.copilotHint'], { ns: 'workflow' })}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start gap-1.5'}
          >
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-components-button-primary-bg px-3 py-2 system-sm-regular whitespace-pre-wrap text-components-button-primary-text'
                  : m.cancelled
                    ? 'max-w-[85%] rounded-2xl rounded-bl-sm bg-components-panel-on-panel-item-bg px-3 py-2 system-sm-regular whitespace-pre-wrap text-text-tertiary italic'
                    : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-components-panel-on-panel-item-bg px-3 py-2 system-sm-regular whitespace-pre-wrap text-text-secondary'
              }
            >
              {renderMentionSegments(
                m.content,
                m.role === 'user' ? 'bubble-user' : 'bubble-assistant',
              )}
            </div>
            {/* Apply / Retry / Undo / Discard actions for assistant proposals */}
            {m.role === 'assistant' && m.pending && (
              <div className="flex items-center gap-1.5">
                {!m.applied ? (
                  <Button
                    size="small"
                    variant="primary"
                    disabled={isGenerating}
                    onClick={() => handleApply(m)}
                  >
                    <RiCheckLine className="mr-1 size-3.5" />
                    {t(($) => $['workflowGenerator.apply'], { ns: 'workflow' })}
                  </Button>
                ) : (
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={isGenerating}
                    onClick={() => handleUndo(m)}
                  >
                    <RiArrowGoBackLine className="mr-1 size-3.5" />
                    {t(($) => $['workflowGenerator.undo'], { ns: 'workflow' })}
                  </Button>
                )}
                <Button
                  size="small"
                  variant="ghost"
                  disabled={isGenerating}
                  onClick={() => handleRetry(m)}
                >
                  <RiRefreshLine className="mr-1 size-3.5" />
                  {t(($) => $['workflowGenerator.retry'], { ns: 'workflow' })}
                </Button>
                {confirmingDiscardId === m.id ? (
                  // Armed: destructive action needs an explicit confirm so a
                  // stray click can't wipe the turn (and any applied graph).
                  <>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={isGenerating}
                      onClick={() => setConfirmingDiscardId(null)}
                    >
                      {t(($) => $['operation.cancel'], { ns: 'common' })}
                    </Button>
                    <Button
                      size="small"
                      variant="primary"
                      tone="destructive"
                      disabled={isGenerating}
                      onClick={() => handleDiscardTurn(m)}
                    >
                      <RiDeleteBinLine className="mr-1 size-3.5" />
                      {t(($) => $['workflowGenerator.discardTurn'], { ns: 'workflow' })}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={isGenerating}
                    title={t(($) => $['workflowGenerator.discardTurnTitle'], { ns: 'workflow' })}
                    onClick={() => setConfirmingDiscardId(m.id)}
                  >
                    <RiDeleteBinLine className="size-3.5" />
                  </Button>
                )}
              </div>
            )}
            {/* Meta line: wall-clock generation time for the turn. */}
            {m.role === 'assistant' && m.durationMs !== undefined && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 system-2xs-regular text-text-quaternary">
                <span>
                  {t(($) => $['workflowGenerator.tookTime'], { ns: 'workflow' })}{' '}
                  {formatDuration(m.durationMs)}
                </span>
              </div>
            )}
          </div>
        ))}
        {isGenerating && (
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-components-panel-on-panel-item-bg px-3 py-2 system-sm-regular text-text-tertiary">
              <RiSparkling2Line className="size-4 animate-pulse text-text-accent" />
              <span>{t(($) => $['workflowGenerator.generating'], { ns: 'workflow' })}</span>
              <span className="text-text-quaternary tabular-nums">
                {formatDuration(genElapsedMs)}
              </span>
            </div>
            <Button size="small" variant="ghost" onClick={handleStop}>
              <RiStopCircleLine className="mr-1 size-3.5" />
              {t(($) => $['workflowGenerator.stop'], { ns: 'workflow' })}
            </Button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-divider-subtle p-3">
        {/* Context nodes pinned from a node's "..." menu ("Add to Copilot") */}
        {pinnedNodes.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="system-2xs-medium-uppercase text-text-tertiary">
              {t(($) => $['workflowGenerator.contextNodes'], { ns: 'workflow' })}
            </span>
            {pinnedNodes.map((chip) => (
              <span
                key={chip.id}
                className="flex max-w-[140px] items-center gap-1 rounded-md bg-state-accent-hover px-1.5 py-0.5 system-2xs-medium text-text-accent"
              >
                <button
                  type="button"
                  className="truncate hover:underline"
                  title={t(($) => $['workflowGenerator.locateNode'], { ns: 'workflow' })}
                  onClick={() => handleChipClick(chip.id)}
                >
                  {chip.title}
                </button>
                <button
                  type="button"
                  aria-label="remove"
                  onClick={() => handleRemovePinned(chip.id)}
                >
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
                    i === mentionActiveIndex
                      ? 'bg-state-base-hover text-text-primary'
                      : 'text-text-secondary'
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
          <MentionInput
            ref={inputRef}
            disabled={isGenerating}
            isPickerOpen={mentionOpen}
            placeholder={t(($) => $['workflowGenerator.copilotPlaceholder'], { ns: 'workflow' })}
            onChange={handleInputChange}
            onHashQueryChange={handleHashQueryChange}
            onEnter={handleSend}
            onPickerKeyDown={handlePickerKeyDown}
          />
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            variant="primary"
            disabled={isGenerating || input.trim().length === 0}
            onClick={handleSend}
          >
            {t(($) => $['workflowGenerator.generate'], { ns: 'workflow' })}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CopilotChat
