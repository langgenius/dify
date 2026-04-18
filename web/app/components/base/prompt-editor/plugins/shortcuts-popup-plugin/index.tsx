import type { LexicalCommand } from 'lexical'
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
} from '@floating-ui/react'
import { cn } from '@langgenius/dify-ui/cn'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

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
  container?: Element | null
  onOpen?: () => void
  onClose?: () => void
}

const META_ALIASES = new Set(['meta', 'cmd', 'command'])
const CTRL_ALIASES = new Set(['ctrl'])
const ALT_ALIASES = new Set(['alt', 'option'])
const SHIFT_ALIASES = new Set(['shift'])

function matchHotkey(event: KeyboardEvent, hotkey?: Hotkey) {
  /* v8 ignore next 2 -- plugin always provides a default hotkey ('mod+/'); undefined hotkey is not reachable via public props flow. @preserve */
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
  container,
  onOpen,
  onClose,
}: ShortcutPopupPluginProps): React.ReactPortal | null {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)
  const portalRef = useRef<HTMLDivElement | null>(null)
  const lastSelectionRef = useRef<Range | null>(null)

  /* v8 ignore next -- defensive non-browser fallback; this client-only plugin runs where document exists (browser/test DOM runtime). @preserve */
  const containerEl = useMemo(() => container ?? (typeof document !== 'undefined' ? document.body : null), [container])
  const useContainer = !!containerEl && containerEl !== document.body

  const { refs, floatingStyles, isPositioned } = useFloating({
    placement: 'bottom-start',
    middleware: [
      offset(0), // fix hide cursor
      shift({
        padding: 8,
        altBoundary: true,
      }),
      flip(),
      size({
        apply({ availableWidth, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.min(400, availableWidth)}px`,
            maxHeight: `${Math.min(300, availableHeight)}px`,
            overflow: 'auto',
          })
        },
        padding: 8,
      }),
    ],
    whileElementsMounted: autoUpdate,
  })

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          const domSelection = window.getSelection()
          /* v8 ignore next 2 -- selection availability is timing-dependent during Lexical updates; guard exists for transient null/zero-range states. @preserve */
          if (domSelection && domSelection.rangeCount > 0)
            lastSelectionRef.current = domSelection.getRangeAt(0).cloneRange()
        }
      })
    })
  }, [editor])

  const isEditorFocused = useCallback(() => {
    const root = editor.getRootElement()
    /* v8 ignore next 2 -- root can be null during Lexical mount/unmount transitions before DOM root attachment. @preserve */
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

    if (range) {
      const rects = range.getClientRects()
      let rect: DOMRect | null = null

      if (rects && rects.length)
        rect = rects[rects.length - 1]!

      else
        rect = range.getBoundingClientRect()

      if (rect.width === 0 && rect.height === 0) {
        const root = editor.getRootElement()
        /* v8 ignore next 10 -- zero-size rect recovery depends on browser layout/selection geometry; deterministic reproduction in the test DOM runtime is unreliable. @preserve */
        if (root) {
          const sc = range.startContainer
          const node = sc.nodeType === Node.ELEMENT_NODE
            ? sc as Element
            : (sc.parentElement || root)

          rect = node.getBoundingClientRect()

          if (rect.width === 0 && rect.height === 0)
            rect = root.getBoundingClientRect()
        }
      }

      if (rect && !(rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0)) {
        const virtualEl = {
          getBoundingClientRect() {
            return rect!
          },
        }
        refs.setReference(virtualEl as Element)
      }
    }

    setOpen(true)
    onOpen?.()
  }, [onOpen])

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
      /* v8 ignore next 2 -- outside-click listener can race with ref cleanup during close/unmount; null-ref path is a safety guard. @preserve */
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
      ref={(node) => {
        portalRef.current = node
        refs.setFloating(node)
      }}
      className={cn(
        useContainer ? '' : 'z-999999',
        'absolute rounded-xl bg-components-panel-bg-blur shadow-lg',
        className,
      )}
      style={{
        ...floatingStyles,
        visibility: isPositioned ? 'visible' : 'hidden',
      }}
    >
      {typeof children === 'function' ? children(closePortal, handleInsert) : (children ?? SHORTCUTS_EMPTY_CONTENT)}
    </div>,
    containerEl,
  )
}
