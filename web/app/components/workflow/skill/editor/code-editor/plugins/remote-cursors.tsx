import type { OnMount } from '@monaco-editor/react'
import type { OnlineUser } from '@/app/components/workflow/collaboration/types'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { skillCollaborationManager } from '@/app/components/workflow/collaboration/skills/skill-collaboration-manager'
import { getUserColor } from '@/app/components/workflow/collaboration/utils/user-color'
import { useAppContext } from '@/context/app-context'

const CURSOR_THROTTLE_MS = 200
const CURSOR_TTL_MS = 15000
const SELECTION_ALPHA = 0.2

type MonacoEditor = Parameters<OnMount>[0]
type MonacoModel = Exclude<ReturnType<MonacoEditor['getModel']>, null>
type MonacoDecorations = Parameters<ReturnType<MonacoEditor['createDecorationsCollection']>['set']>[0]
type MonacoDecorationsCollection = ReturnType<MonacoEditor['createDecorationsCollection']>
type MonacoDecoration = MonacoDecorations extends readonly (infer T)[] ? T : never

type SkillCursorInfo = {
  userId: string
  start: number
  end: number
  timestamp: number
}

type SkillCursorMap = Record<string, SkillCursorInfo>

type CursorOverlayItem = {
  userId: string
  x: number
  y: number
  height: number
  name: string
  color: string
}

type CursorRenderState = {
  positions: CursorOverlayItem[]
}

type CursorRenderAction
  = | { type: 'set', positions: CursorOverlayItem[] }
    | { type: 'clear' }

const cursorRenderReducer = (_state: CursorRenderState, action: CursorRenderAction): CursorRenderState => {
  if (action.type === 'clear')
    return { positions: [] }
  return { positions: action.positions }
}

const hashUserId = (userId: string): string => {
  let hash = 0
  for (let i = 0; i < userId.length; i++)
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return hash.toString(36)
}

const getSelectionClassName = (userId: string): string => `skill-code-selection-${hashUserId(userId)}`

const hexToRgba = (hex: string, alpha: number): string => {
  const clean = hex.replace('#', '')
  if (clean.length !== 6)
    return `rgba(0, 0, 0, ${alpha})`
  const r = Number.parseInt(clean.slice(0, 2), 16)
  const g = Number.parseInt(clean.slice(2, 4), 16)
  const b = Number.parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const clampOffset = (offset: number, max: number) => Math.max(0, Math.min(offset, max))

const getSelectionRange = (model: MonacoModel, start: number, end: number) => {
  const maxOffset = model.getValueLength()
  const safeStart = clampOffset(start, maxOffset)
  const safeEnd = clampOffset(end, maxOffset)
  const startPos = model.getPositionAt(Math.min(safeStart, safeEnd))
  const endPos = model.getPositionAt(Math.max(safeStart, safeEnd))
  return {
    startLineNumber: startPos.lineNumber,
    startColumn: startPos.column,
    endLineNumber: endPos.lineNumber,
    endColumn: endPos.column,
  }
}

type UseSkillCodeCursorsProps = {
  editor: MonacoEditor | null
  fileId: string | null
  enabled: boolean
}

export const useSkillCodeCursors = ({ editor, fileId, enabled }: UseSkillCodeCursorsProps) => {
  const { userProfile } = useAppContext()
  const myUserId = userProfile?.id || null
  const [cursorMap, setCursorMap] = useState<SkillCursorMap>({})
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [renderState, dispatchRender] = useReducer(cursorRenderReducer, { positions: [] })

  const cursorMapRef = useRef<SkillCursorMap>({})
  const rafIdRef = useRef<number | null>(null)
  const decorationCollectionRef = useRef<MonacoDecorationsCollection | null>(null)
  const styleRef = useRef<HTMLStyleElement | null>(null)
  const pendingCursorRef = useRef<{ start: number, end: number } | null>(null)
  const lastCursorRef = useRef<{ start: number, end: number } | null>(null)
  const throttleTimerRef = useRef<number | null>(null)

  const effectiveCursorMap = useMemo(() => (enabled && fileId ? cursorMap : {}), [cursorMap, enabled, fileId])

  useEffect(() => {
    cursorMapRef.current = effectiveCursorMap
  }, [effectiveCursorMap])

  useEffect(() => {
    return collaborationManager.onOnlineUsersUpdate(setOnlineUsers)
  }, [])

  useEffect(() => {
    if (!enabled || !fileId)
      return

    return skillCollaborationManager.onCursorUpdate(fileId, (nextCursors) => {
      setCursorMap(nextCursors)
    })
  }, [enabled, fileId])

  const onlineUserMap = useMemo(() => {
    return onlineUsers.reduce<Record<string, OnlineUser>>((acc, user) => {
      acc[user.user_id] = user
      return acc
    }, {})
  }, [onlineUsers])

  const updateSelectionStyles = useCallback((userIds: string[]) => {
    if (typeof document === 'undefined')
      return

    if (!styleRef.current) {
      const style = document.createElement('style')
      style.dataset.skillCodeCursor = 'true'
      document.head.appendChild(style)
      styleRef.current = style
    }

    const uniqueIds = Array.from(new Set(userIds))
    styleRef.current.textContent = uniqueIds.map((userId) => {
      const color = getUserColor(userId)
      return `.${getSelectionClassName(userId)} { background-color: ${hexToRgba(color, SELECTION_ALPHA)}; }`
    }).join('\n')
  }, [])

  useEffect(() => {
    return () => {
      if (styleRef.current) {
        styleRef.current.remove()
        styleRef.current = null
      }
    }
  }, [])

  const scheduleRecalc = useCallback(() => {
    if (rafIdRef.current !== null)
      return

    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null
      if (!enabled || !fileId || !editor) {
        dispatchRender({ type: 'clear' })
        return
      }

      const model = editor.getModel()
      if (!model) {
        dispatchRender({ type: 'clear' })
        return
      }

      const now = Date.now()
      const positions: CursorOverlayItem[] = []
      Object.values(cursorMapRef.current).forEach((cursor) => {
        if (cursor.userId === myUserId)
          return
        if (now - cursor.timestamp > CURSOR_TTL_MS)
          return

        const maxOffset = model.getValueLength()
        const endOffset = clampOffset(cursor.end, maxOffset)
        const caretPosition = model.getPositionAt(endOffset)
        const visible = editor.getScrolledVisiblePosition(caretPosition)
        if (!visible)
          return

        const user = onlineUserMap[cursor.userId]
        positions.push({
          userId: cursor.userId,
          x: visible.left,
          y: visible.top,
          height: visible.height || 20,
          name: user?.username || cursor.userId.slice(-4),
          color: getUserColor(cursor.userId),
        })
      })

      dispatchRender({ type: 'set', positions })
    })
  }, [editor, enabled, fileId, myUserId, onlineUserMap])

  useEffect(() => {
    scheduleRecalc()
  }, [scheduleRecalc, cursorMap, onlineUserMap])

  useEffect(() => {
    if (!enabled || !fileId || !editor)
      return

    const disposables = [
      editor.onDidScrollChange(scheduleRecalc),
      editor.onDidLayoutChange(scheduleRecalc),
      editor.onDidChangeModelContent(scheduleRecalc),
    ]

    return () => {
      disposables.forEach(disposable => disposable.dispose())
    }
  }, [editor, enabled, fileId, scheduleRecalc])

  useEffect(() => {
    if (!editor) {
      decorationCollectionRef.current = null
      return
    }

    decorationCollectionRef.current = editor.createDecorationsCollection()

    return () => {
      decorationCollectionRef.current?.clear()
      decorationCollectionRef.current = null
    }
  }, [editor])

  useEffect(() => {
    if (!editor) {
      updateSelectionStyles([])
      return
    }

    if (!enabled || !fileId) {
      decorationCollectionRef.current?.clear()
      updateSelectionStyles([])
      return
    }

    const model = editor.getModel()
    if (!model)
      return

    const now = Date.now()
    const decorations: MonacoDecoration[] = []
    const activeUserIds: string[] = []

    Object.values(effectiveCursorMap).forEach((cursor) => {
      if (cursor.userId === myUserId)
        return
      if (now - cursor.timestamp > CURSOR_TTL_MS)
        return
      if (cursor.start === cursor.end)
        return

      activeUserIds.push(cursor.userId)
      decorations.push({
        range: getSelectionRange(model, cursor.start, cursor.end),
        options: {
          inlineClassName: getSelectionClassName(cursor.userId),
        },
      })
    })

    updateSelectionStyles(activeUserIds)
    decorationCollectionRef.current?.set(decorations)
  }, [editor, enabled, fileId, effectiveCursorMap, myUserId, updateSelectionStyles])

  useEffect(() => {
    if (!enabled || !fileId || !editor)
      return

    const flushPending = () => {
      const pending = pendingCursorRef.current
      pendingCursorRef.current = null
      if (!pending)
        return

      if (lastCursorRef.current
        && lastCursorRef.current.start === pending.start
        && lastCursorRef.current.end === pending.end) {
        return
      }

      lastCursorRef.current = pending
      skillCollaborationManager.emitCursorUpdate(fileId, pending)
    }

    const scheduleEmit = (cursor: { start: number, end: number }) => {
      pendingCursorRef.current = cursor
      if (throttleTimerRef.current !== null)
        return

      throttleTimerRef.current = window.setTimeout(() => {
        throttleTimerRef.current = null
        flushPending()
      }, CURSOR_THROTTLE_MS)
    }

    const emitClear = () => {
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }
      pendingCursorRef.current = null
      lastCursorRef.current = null
      skillCollaborationManager.emitCursorUpdate(fileId, null)
    }

    const handleSelectionChange = () => {
      const model = editor.getModel()
      const selection = editor.getSelection()
      if (!model || !selection)
        return

      const start = model.getOffsetAt(selection.getStartPosition())
      const end = model.getOffsetAt(selection.getEndPosition())
      scheduleEmit({ start, end })
    }

    const selectionDisposable = editor.onDidChangeCursorSelection(handleSelectionChange)
    const focusDisposable = editor.onDidFocusEditorText(handleSelectionChange)
    const blurDisposable = editor.onDidBlurEditorText(emitClear)
    const blurWidgetDisposable = editor.onDidBlurEditorWidget(emitClear)

    handleSelectionChange()

    return () => {
      selectionDisposable.dispose()
      focusDisposable.dispose()
      blurDisposable.dispose()
      blurWidgetDisposable.dispose()
      emitClear()
    }
  }, [editor, enabled, fileId])

  const overlay = useMemo(() => {
    if (!enabled || !fileId || renderState.positions.length === 0)
      return null

    return (
      <>
        {renderState.positions.map(position => (
          <div
            key={position.userId}
            className="absolute"
            style={{
              left: position.x,
              top: position.y,
            }}
          >
            <div
              className="absolute left-0 top-0 w-[2px]"
              style={{
                height: Math.max(position.height, 16),
                backgroundColor: position.color,
              }}
            />
            <div
              className="absolute -top-5 left-2 max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm"
              style={{
                backgroundColor: position.color,
              }}
            >
              {position.name}
            </div>
          </div>
        ))}
      </>
    )
  }, [enabled, fileId, renderState.positions])

  return {
    overlay,
  }
}
