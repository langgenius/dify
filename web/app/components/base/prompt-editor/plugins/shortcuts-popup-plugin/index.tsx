import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { LexicalCommand } from 'lexical'
import {
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import cn from '@/utils/classnames'

export const SHORTCUTS_EMPTY_CONTENT = 'shortcuts_empty_content'

// Hotkey can be:
// - string: 'mod+/'
// - string[]: ['mod', '/']
// - string[][]: [['mod', '/'], ['mod', 'shift', '/']] (any combo matches)
// - function: custom matcher
export type Hotkey = string | string[] | string[][] | ((e: KeyboardEvent) => boolean)

type ShortcutPopupPluginProps = {
  hotkey?: Hotkey
  children?: React.ReactNode | ((close: () => void, onInsert: (command: LexicalCommand<unknown>, params: any[]) => void) => React.ReactNode)
  className?: string
  style?: React.CSSProperties
  container?: Element | null
  offset?: {
    x?: number
    y?: number
  }
  onOpen?: () => void
  onClose?: () => void
}

type Position = {
  top: number
  left: number
}

const META_ALIASES = new Set(['meta', 'cmd', 'command'])
const CTRL_ALIASES = new Set(['ctrl'])
const ALT_ALIASES = new Set(['alt', 'option'])
const SHIFT_ALIASES = new Set(['shift'])

function matchHotkey(event: KeyboardEvent, hotkey?: Hotkey) {
  if (!hotkey)
    return false

  if (typeof hotkey === 'function')
    return hotkey(event)

  const matchCombo = (tokens: string[]) => {
    const parts = tokens.map(t => t.toLowerCase().trim()).filter(Boolean)
    let expectedKey: string | null = null

    let needMod = false
    let needCtrl = false
    let needMeta = false
    let needAlt = false
    let needShift = false

    for (const p of parts) {
      if (p === 'mod') {
        needMod = true
        continue
      }
      if (CTRL_ALIASES.has(p)) {
        needCtrl = true
        continue
      }
      if (META_ALIASES.has(p)) {
        needMeta = true
        continue
      }
      if (ALT_ALIASES.has(p)) {
        needAlt = true
        continue
      }
      if (SHIFT_ALIASES.has(p)) {
        needShift = true
        continue
      }
      expectedKey = p
    }

    if (needMod && !(event.metaKey || event.ctrlKey))
      return false
    if (needCtrl && !event.ctrlKey)
      return false
    if (needMeta && !event.metaKey)
      return false
    if (needAlt && !event.altKey)
      return false
    if (needShift && !event.shiftKey)
      return false

    if (expectedKey) {
      const k = event.key.toLowerCase()
      const normalized = k === ' ' ? 'space' : k
      if (normalized !== expectedKey)
        return false
    }

    return true
  }

  if (Array.isArray(hotkey)) {
    const isNested = hotkey.length > 0 && Array.isArray((hotkey as unknown[])[0])
    if (isNested) {
      const combos = hotkey as string[][]
      return combos.some(tokens => matchCombo(tokens))
    }
    else {
      const tokens = hotkey as string[]
      return matchCombo(tokens)
    }
  }

  const tokensFromString = hotkey
    .toLowerCase()
    .split('+')
    .map(t => t.trim())
    .filter(Boolean)
  return matchCombo(tokensFromString)
}

export default function ShortcutsPopupPlugin({
  hotkey = 'mod+/',
  children,
  className,
  style,
  container,
  offset,
  onOpen,
  onClose,
}: ShortcutPopupPluginProps): React.ReactPortal | null {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 })
  const portalRef = useRef<HTMLDivElement | null>(null)
  const lastSelectionRef = useRef<Range | null>(null)

  const containerEl = useMemo(() => container ?? (typeof document !== 'undefined' ? document.body : null), [container])
  const useContainer = !!containerEl && containerEl !== document.body

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          const domSelection = window.getSelection()
          if (domSelection && domSelection.rangeCount > 0)
            lastSelectionRef.current = domSelection.getRangeAt(0).cloneRange()
        }
      })
    })
  }, [editor])

  const setPositionFromRange = useCallback((range: Range | null) => {
    if (!range) return
    const dx = offset?.x ?? 0
    const dy = offset?.y ?? 0

    let rect: DOMRect | null = null
    const rects = range.getClientRects()
    if (rects && rects.length) {
      rect = rects[rects.length - 1]
    }
    else {
      const r = range.getBoundingClientRect()
      if (!(r.top === 0 && r.left === 0 && r.width === 0 && r.height === 0))
        rect = r
    }

    if (!rect) {
      const root = editor.getRootElement()
      const sc = range.startContainer
      const anchorEl = (sc.nodeType === Node.ELEMENT_NODE ? sc as Element : (sc.parentElement || root)) as Element | null
      if (!anchorEl) return
      const ar = anchorEl.getBoundingClientRect()
      rect = new DOMRect(ar.left, ar.top, ar.width, ar.height)
    }

    if (useContainer) {
      const crect = (containerEl as HTMLElement).getBoundingClientRect()
      setPosition({
        top: rect!.bottom - crect.top + dy,
        left: rect!.left - crect.left + dx,
      })
    }
    else {
      setPosition({
        top: rect!.bottom + window.scrollY + dy,
        left: rect!.left + window.scrollX + dx,
      })
    }
  }, [editor, containerEl, useContainer, offset?.x, offset?.y])

  const isEditorFocused = useCallback(() => {
    const root = editor.getRootElement()
    if (!root)
      return false
    return root.contains(document.activeElement)
  }, [editor])

  const openPortal = useCallback(() => {
    const domSelection = window.getSelection()
    let range: Range | null = null
    if (domSelection && domSelection.rangeCount > 0)
      range = domSelection.getRangeAt(0).cloneRange()
    else
      range = lastSelectionRef.current

    setPositionFromRange(range)
    setOpen(true)
    onOpen?.()
  }, [onOpen, setPositionFromRange])

  const closePortal = useCallback(() => {
    setOpen(false)
    onClose?.()
  }, [onClose])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (open && event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        closePortal()
        return
      }

      if (!isEditorFocused())
        return

      if (matchHotkey(event, hotkey)) {
        event.preventDefault()
        openPortal()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [hotkey, open, isEditorFocused, openPortal, closePortal])

  useEffect(() => {
    if (!open)
      return

    const onMouseDown = (e: MouseEvent) => {
      if (!portalRef.current)
        return
      if (!portalRef.current.contains(e.target as Node))
        closePortal()
    }
    document.addEventListener('mousedown', onMouseDown, false)
    return () => document.removeEventListener('mousedown', onMouseDown, false)
  }, [open, closePortal])

  const handleInsert = useCallback((command: LexicalCommand<unknown>, params: any) => {
    editor.dispatchCommand(command, params)
    closePortal()
  }, [editor, closePortal])

  if (!open || !containerEl)
    return null

  return createPortal(
    <div
      ref={portalRef}
      className={cn(
        useContainer ? '' : 'z-[999999]',
        'absolute rounded-md bg-slate-50 shadow-lg',
        className,
      )}
      style={{ top: `${position.top}px`, left: `${position.left}px`, ...style }}
    >
      {typeof children === 'function' ? children(closePortal, handleInsert) : (children ?? SHORTCUTS_EMPTY_CONTENT)}
    </div>,
    containerEl,
  )
}
