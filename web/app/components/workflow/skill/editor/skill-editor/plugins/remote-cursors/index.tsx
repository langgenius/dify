'use client'
import type { RangeSelection, TextNode } from 'lexical'
import type { OnlineUser } from '@/app/components/workflow/collaboration/types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from 'lexical'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { skillCollaborationManager } from '@/app/components/workflow/collaboration/skills/skill-collaboration-manager'
import { getUserColor } from '@/app/components/workflow/collaboration/utils/user-color'
import { useAppContext } from '@/context/app-context'

const CURSOR_THROTTLE_MS = 200
const CURSOR_TTL_MS = 15000
const CURSOR_RECALC_INTERVAL_MS = 4000

type SkillCursorInfo = {
  userId: string
  start: number
  end: number
  timestamp: number
}

type SkillCursorMap = Record<string, SkillCursorInfo>

type TextOffset = {
  node: TextNode
  start: number
  end: number
}

type TextOffsetMap = {
  textNodes: TextOffset[]
  newlinePositions: Set<number>
  elementEntries: Array<{ key: string, start: number, end: number, hasText: boolean }>
}

type CursorPosition = {
  userId: string
  x: number
  y: number
  height: number
}

type SelectionRect = {
  userId: string
  x: number
  y: number
  width: number
  height: number
}

type CursorRenderState = {
  positions: CursorPosition[]
  selectionRects: SelectionRect[]
}

type CursorRenderAction
  = | { type: 'set', positions: CursorPosition[], selectionRects: SelectionRect[] }
    | { type: 'clear' }

const cursorRenderReducer = (_state: CursorRenderState, action: CursorRenderAction): CursorRenderState => {
  if (action.type === 'clear')
    return { positions: [], selectionRects: [] }
  return { positions: action.positions, selectionRects: action.selectionRects }
}

const buildTextOffsetMap = (): TextOffsetMap => {
  const root = $getRoot()
  const textNodes: TextOffset[] = []
  const newlinePositions = new Set<number>()
  const elementEntries: Array<{ key: string, start: number, end: number, hasText: boolean }> = []
  let cursor = 0
  const children = root.getChildren()

  children.forEach((child, index) => {
    const startOffset = cursor
    const childTextNodes = $isElementNode(child) ? child.getAllTextNodes() : ($isTextNode(child) ? [child] : [])
    let hasText = false
    childTextNodes.forEach((node) => {
      const text = node.getTextContent()
      if (text.length > 0)
        hasText = true
      const start = cursor
      const end = cursor + text.length
      textNodes.push({ node, start, end })
      cursor = end
    })
    elementEntries.push({ key: child.getKey(), start: startOffset, end: cursor, hasText })

    if (index < children.length - 1) {
      newlinePositions.add(cursor)
      cursor += 1
    }
  })

  return { textNodes, newlinePositions, elementEntries }
}

const getPointOffset = (map: TextOffsetMap, point: RangeSelection['anchor']): number | null => {
  for (const item of map.textNodes) {
    if (item.node.getKey() === point.key) {
      const length = item.node.getTextContent().length
      const clamped = Math.max(0, Math.min(point.offset, length))
      return item.start + clamped
    }
  }
  const elementEntry = map.elementEntries.find(entry => entry.key === point.key)
  if (elementEntry) {
    if (point.offset <= 0)
      return elementEntry.start
    return elementEntry.end
  }
  return null
}

const getSelectionOffsets = (
  selection: RangeSelection,
  map: TextOffsetMap,
): { start: number, end: number } | null => {
  const anchorOffset = getPointOffset(map, selection.anchor)
  const focusOffset = getPointOffset(map, selection.focus)
  if (anchorOffset === null || focusOffset === null)
    return null

  return {
    start: Math.min(anchorOffset, focusOffset),
    end: Math.max(anchorOffset, focusOffset),
  }
}

const findTextNodeAtOffset = (map: TextOffsetMap, offset: number): { node: TextNode, offset: number } | null => {
  if (map.textNodes.length === 0)
    return null

  if (map.newlinePositions.has(offset)) {
    for (let i = map.textNodes.length - 1; i >= 0; i--) {
      const item = map.textNodes[i]
      if (item.end <= offset)
        return { node: item.node, offset: item.node.getTextContent().length }
    }
  }

  for (const item of map.textNodes) {
    if (offset <= item.end) {
      const localOffset = Math.max(0, Math.min(offset - item.start, item.node.getTextContent().length))
      return { node: item.node, offset: localOffset }
    }
  }

  const last = map.textNodes[map.textNodes.length - 1]
  return { node: last.node, offset: last.node.getTextContent().length }
}

const findEmptyElementAtOffset = (
  map: TextOffsetMap,
  offset: number,
): { key: string } | null => {
  for (const entry of map.elementEntries) {
    if (!entry.hasText && offset >= entry.start && offset <= entry.end)
      return { key: entry.key }
  }
  return null
}

const getCursorPosition = (
  map: TextOffsetMap,
  offset: number,
  rootElement: HTMLElement,
  getElementByKey: (key: string) => HTMLElement | null,
): { x: number, y: number, height: number } | null => {
  const emptyEntry = map.newlinePositions.has(offset)
    ? findEmptyElementAtOffset(map, offset)
    : null
  const target = emptyEntry ? null : findTextNodeAtOffset(map, offset)
  if (!target) {
    const fallbackEntry = emptyEntry || findEmptyElementAtOffset(map, offset)
    if (!fallbackEntry)
      return null

    const domElement = getElementByKey(fallbackEntry.key)
    if (!domElement)
      return null

    const rect = domElement.getBoundingClientRect()
    const rootRect = rootElement.getBoundingClientRect()
    const lineHeight = Number.parseFloat(window.getComputedStyle(rootElement).lineHeight || '') || 16
    return {
      x: rect.left - rootRect.left + rootElement.scrollLeft,
      y: rect.top - rootRect.top + rootElement.scrollTop,
      height: rect.height || lineHeight,
    }
  }

  const domElement = getElementByKey(target.node.getKey())
  if (!domElement)
    return null

  const textNode = domElement.firstChild
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE)
    return null

  const textLength = textNode.textContent?.length ?? 0
  const clampedOffset = Math.max(0, Math.min(target.offset, textLength))
  const range = document.createRange()
  range.setStart(textNode, clampedOffset)
  range.setEnd(textNode, clampedOffset)

  const rect = range.getBoundingClientRect()
  const rootRect = rootElement.getBoundingClientRect()
  const lineHeight = Number.parseFloat(window.getComputedStyle(rootElement).lineHeight || '') || 16
  const height = rect.height || lineHeight

  return {
    x: rect.left - rootRect.left + rootElement.scrollLeft,
    y: rect.top - rootRect.top + rootElement.scrollTop,
    height,
  }
}

const hexToRgba = (hex: string, alpha: number): string => {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6)
    return hex
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const getSelectionRects = (
  map: TextOffsetMap,
  start: number,
  end: number,
  rootElement: HTMLElement,
  getElementByKey: (key: string) => HTMLElement | null,
): Array<Omit<SelectionRect, 'userId'>> => {
  if (start === end)
    return []

  const normalizedStart = Math.max(0, Math.min(start, end))
  const normalizedEnd = Math.max(normalizedStart, Math.max(start, end))
  const rootRect = rootElement.getBoundingClientRect()
  const rects: Array<Omit<SelectionRect, 'userId'>> = []

  for (const item of map.textNodes) {
    if (item.end < normalizedStart)
      continue
    if (item.start > normalizedEnd)
      break

    const localStart = Math.max(normalizedStart, item.start) - item.start
    const localEnd = Math.min(normalizedEnd, item.end) - item.start
    if (localEnd <= localStart)
      continue

    const domElement = getElementByKey(item.node.getKey())
    if (!domElement)
      continue

    const textNode = domElement.firstChild
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE)
      continue

    const textLength = textNode.textContent?.length ?? 0
    const startOffset = Math.max(0, Math.min(localStart, textLength))
    const endOffset = Math.max(0, Math.min(localEnd, textLength))
    if (endOffset <= startOffset)
      continue

    const range = document.createRange()
    range.setStart(textNode, startOffset)
    range.setEnd(textNode, endOffset)

    Array.from(range.getClientRects()).forEach((rect) => {
      if (rect.width === 0 || rect.height === 0)
        return
      rects.push({
        x: rect.left - rootRect.left + rootElement.scrollLeft,
        y: rect.top - rootRect.top + rootElement.scrollTop,
        width: rect.width,
        height: rect.height,
      })
    })
  }

  for (const entry of map.elementEntries) {
    if (entry.hasText)
      continue
    if (entry.end < normalizedStart || entry.start > normalizedEnd)
      continue

    const domElement = getElementByKey(entry.key)
    if (!domElement)
      continue
    const rect = domElement.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0)
      continue
    rects.push({
      x: rect.left - rootRect.left + rootElement.scrollLeft,
      y: rect.top - rootRect.top + rootElement.scrollTop,
      width: rect.width,
      height: rect.height,
    })
  }

  return rects
}

type LocalCursorPluginProps = {
  fileId?: string
  enabled?: boolean
}

export const LocalCursorPlugin = ({ fileId, enabled }: LocalCursorPluginProps) => {
  const [editor] = useLexicalComposerContext()
  const lastEmittedCursorRef = useRef<{ start: number, end: number } | null>(null)
  const lastEmitRef = useRef(0)
  const pendingCursorRef = useRef<{ start: number, end: number } | null | undefined>(undefined)
  const throttleTimerRef = useRef<number | null>(null)

  const emitCursor = useCallback((cursor: { start: number, end: number } | null) => {
    if (!enabled || !fileId)
      return
    skillCollaborationManager.emitCursorUpdate(fileId, cursor)
  }, [enabled, fileId])

  const isSameCursor = useCallback((
    a: { start: number, end: number } | null,
    b: { start: number, end: number } | null,
  ) => {
    if (a === b)
      return true
    if (!a || !b)
      return false
    return a.start === b.start && a.end === b.end
  }, [])

  const flushPending = useCallback(() => {
    const pending = pendingCursorRef.current
    pendingCursorRef.current = undefined
    if (pending === undefined)
      return

    if (!isSameCursor(pending, lastEmittedCursorRef.current)) {
      emitCursor(pending)
      lastEmittedCursorRef.current = pending
      lastEmitRef.current = Date.now()
    }
  }, [emitCursor, isSameCursor])

  const handleSelectionChange = useCallback(() => {
    if (!enabled || !fileId)
      return

    editor.getEditorState().read(() => {
      const now = Date.now()
      const selection = $getSelection()
      let nextCursor: { start: number, end: number } | null = null
      if (!$isRangeSelection(selection)) {
        nextCursor = null
      }
      else {
        const map = buildTextOffsetMap()
        const offsets = getSelectionOffsets(selection, map)
        if (!offsets)
          return

        nextCursor = offsets
      }

      if (isSameCursor(nextCursor, lastEmittedCursorRef.current))
        return

      const elapsed = now - lastEmitRef.current
      if (elapsed >= CURSOR_THROTTLE_MS) {
        if (throttleTimerRef.current !== null) {
          window.clearTimeout(throttleTimerRef.current)
          throttleTimerRef.current = null
        }
        pendingCursorRef.current = undefined
        emitCursor(nextCursor)
        lastEmittedCursorRef.current = nextCursor
        lastEmitRef.current = now
        return
      }

      pendingCursorRef.current = nextCursor
      if (throttleTimerRef.current === null) {
        throttleTimerRef.current = window.setTimeout(() => {
          throttleTimerRef.current = null
          flushPending()
        }, CURSOR_THROTTLE_MS - elapsed)
      }
    })
  }, [editor, emitCursor, enabled, fileId, flushPending, isSameCursor])

  useEffect(() => {
    if (!enabled || !fileId)
      return

    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        handleSelectionChange()
        return false
      },
      COMMAND_PRIORITY_LOW,
    )

    const unregisterBlur = editor.registerCommand(
      BLUR_COMMAND,
      () => {
        if (throttleTimerRef.current !== null) {
          window.clearTimeout(throttleTimerRef.current)
          throttleTimerRef.current = null
        }
        pendingCursorRef.current = undefined
        emitCursor(null)
        lastEmittedCursorRef.current = null
        lastEmitRef.current = Date.now()
        return false
      },
      COMMAND_PRIORITY_LOW,
    )

    const unregisterUpdate = editor.registerUpdateListener(() => {
      handleSelectionChange()
    })

    return () => {
      unregisterSelection()
      unregisterBlur()
      unregisterUpdate()
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }
    }
  }, [editor, emitCursor, enabled, fileId, flushPending, handleSelectionChange])

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }
      pendingCursorRef.current = undefined
      if (fileId)
        skillCollaborationManager.emitCursorUpdate(fileId, null)
    }
  }, [fileId])

  return null
}

type SkillRemoteCursorsProps = {
  fileId?: string
  enabled?: boolean
}

export const SkillRemoteCursors = ({ fileId, enabled }: SkillRemoteCursorsProps) => {
  const [editor] = useLexicalComposerContext()
  const { userProfile } = useAppContext()
  const myUserId = userProfile?.id || null
  const [cursorMap, setCursorMap] = useState<SkillCursorMap>({})
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [renderState, dispatchRender] = useReducer(cursorRenderReducer, {
    positions: [],
    selectionRects: [],
  })
  const cursorMapRef = useRef<SkillCursorMap>({})
  const rafIdRef = useRef<number | null>(null)
  const effectiveCursorMap = useMemo(() => (enabled && fileId ? cursorMap : {}), [cursorMap, enabled, fileId])

  useEffect(() => {
    if (!enabled || !fileId)
      return

    return skillCollaborationManager.onCursorUpdate(fileId, (nextCursors) => {
      setCursorMap(nextCursors)
    })
  }, [enabled, fileId])

  useEffect(() => {
    cursorMapRef.current = effectiveCursorMap
  }, [effectiveCursorMap])

  useEffect(() => {
    return collaborationManager.onOnlineUsersUpdate(setOnlineUsers)
  }, [])

  const onlineUserMap = useMemo(() => {
    return onlineUsers.reduce<Record<string, OnlineUser>>((acc, user) => {
      acc[user.user_id] = user
      return acc
    }, {})
  }, [onlineUsers])

  const scheduleRecalc = useCallback(() => {
    if (rafIdRef.current !== null)
      return
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null
      if (!enabled || !fileId) {
        dispatchRender({ type: 'clear' })
        return
      }

      const rootElement = editor.getRootElement()
      if (!rootElement) {
        dispatchRender({ type: 'clear' })
        return
      }

      editor.getEditorState().read(() => {
        const map = buildTextOffsetMap()
        const now = Date.now()
        const next: CursorPosition[] = []
        const nextSelection: SelectionRect[] = []
        if (map.textNodes.length === 0) {
          const lineHeight = Number.parseFloat(window.getComputedStyle(rootElement).lineHeight || '') || 16
          Object.entries(cursorMapRef.current).forEach(([userId, cursor]) => {
            if (now - cursor.timestamp > CURSOR_TTL_MS)
              return

            if (userId !== myUserId) {
              next.push({
                userId,
                x: rootElement.scrollLeft,
                y: rootElement.scrollTop,
                height: lineHeight,
              })
            }
          })

          dispatchRender({ type: 'set', positions: next, selectionRects: nextSelection })
          return
        }

        Object.entries(cursorMapRef.current).forEach(([userId, cursor]) => {
          if (now - cursor.timestamp > CURSOR_TTL_MS)
            return

          const caretOffset = cursor.end
          if (userId !== myUserId) {
            const pos = getCursorPosition(map, caretOffset, rootElement, key => editor.getElementByKey(key))
            if (pos) {
              next.push({
                userId,
                ...pos,
              })
            }
          }

          if (cursor.start !== cursor.end) {
            const rects = getSelectionRects(
              map,
              cursor.start,
              cursor.end,
              rootElement,
              key => editor.getElementByKey(key),
            )
            rects.forEach(rect => nextSelection.push({ userId, ...rect }))
          }
        })

        dispatchRender({ type: 'set', positions: next, selectionRects: nextSelection })
      })
    })
  }, [editor, enabled, fileId, myUserId])

  useEffect(() => {
    scheduleRecalc()
  }, [scheduleRecalc, cursorMap, onlineUserMap])

  useEffect(() => {
    if (!enabled || !fileId)
      return

    const unregister = editor.registerUpdateListener(() => {
      scheduleRecalc()
    })

    const timer = window.setInterval(scheduleRecalc, CURSOR_RECALC_INTERVAL_MS)

    return () => {
      unregister()
      window.clearInterval(timer)
    }
  }, [editor, enabled, fileId, scheduleRecalc])

  if (!enabled || !fileId || renderState.positions.length === 0)
    return null

  return (
    <div className="pointer-events-none absolute inset-0 z-[9]">
      {renderState.selectionRects.map((rect) => {
        if (rect.userId === myUserId)
          return null
        const color = getUserColor(rect.userId)
        const key = `${rect.userId}-${Math.round(rect.x)}-${Math.round(rect.y)}-${Math.round(rect.width)}-${Math.round(rect.height)}`
        return (
          <div
            key={key}
            className="absolute rounded-[2px]"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              backgroundColor: hexToRgba(color, 0.2),
            }}
          />
        )
      })}
      {renderState.positions.map((cursor) => {
        const user = onlineUserMap[cursor.userId]
        const name = user?.username || cursor.userId.slice(-4)
        const color = getUserColor(cursor.userId)
        const labelOffset = cursor.y < 20
          ? Math.max(cursor.height + 4, 18)
          : -20

        return (
          <div
            key={cursor.userId}
            className="absolute"
            style={{
              left: cursor.x,
              top: cursor.y,
            }}
          >
            <div
              className="absolute left-0 top-0 w-[2px]"
              style={{
                height: Math.max(cursor.height, 16),
                backgroundColor: color,
              }}
            />
            <div
              className="absolute left-2 max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm"
              style={{
                top: labelOffset,
                backgroundColor: color,
              }}
            >
              {name}
            </div>
          </div>
        )
      })}
    </div>
  )
}
