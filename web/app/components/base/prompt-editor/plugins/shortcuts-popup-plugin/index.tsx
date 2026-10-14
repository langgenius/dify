import type { Hotkey } from '@tanstack/react-hotkeys'
import type { LexicalCommand } from 'lexical'
import type { CSSProperties } from 'react'
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/react'
import { cn } from '@langgenius/dify-ui/cn'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { $getSelection, $isRangeSelection } from 'lexical'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

export const SHORTCUTS_EMPTY_CONTENT = 'shortcuts_empty_content'
export type ShortcutPopupInsertHandler = <Payload>(
  command: LexicalCommand<Payload>,
  params: Payload,
) => void
export type ShortcutPopupDisplayMode = 'selection' | 'workflow-panel-adjacent-center'

type ShortcutPopupPluginProps = {
  hotkey?: Hotkey
  children?:
    | React.ReactNode
    | ((close: () => void, onInsert: ShortcutPopupInsertHandler) => React.ReactNode)
  className?: string
  container?: Element | null
  displayMode?: ShortcutPopupDisplayMode
  onOpen?: () => void
  onClose?: () => void
}

const VIEWPORT_PADDING = 8
const PANEL_GAP = 4
const POPUP_MAX_WIDTH = 400

type FixedPlacementState = {
  right: number
  top: number
  availableWidth: number
  availableHeight: number
}

function getWorkflowPanelAdjacentPlacement(): FixedPlacementState {
  const rightPanel = document.querySelector('[data-workflow-right-panel]') as HTMLElement | null
  const rightPanelRect = rightPanel?.getBoundingClientRect()
  const rightBoundary =
    rightPanelRect && rightPanelRect.left > 0 ? rightPanelRect.left : window.innerWidth
  const topBoundary = rightPanelRect?.top ?? 56
  const bottomBoundary = window.innerHeight - VIEWPORT_PADDING
  const availableWidth = Math.max(0, rightBoundary - VIEWPORT_PADDING * 2)
  const availableHeight = Math.max(0, bottomBoundary - topBoundary)

  return {
    right: Math.max(VIEWPORT_PADDING, window.innerWidth - rightBoundary + PANEL_GAP),
    top: topBoundary + availableHeight / 2,
    availableWidth,
    availableHeight,
  }
}

function getWorkflowPanelAdjacentPlacementSnapshot() {
  /* v8 ignore next 2 -- server/non-browser fallback for a client-only positioning branch. @preserve */
  if (typeof window === 'undefined' || typeof document === 'undefined') return '0|0|0|0'

  const placement = getWorkflowPanelAdjacentPlacement()
  return [placement.right, placement.top, placement.availableWidth, placement.availableHeight].join(
    '|',
  )
}

function parseWorkflowPanelAdjacentPlacement(snapshot: string): FixedPlacementState {
  const [right = '0', top = '0', availableWidth = '0', availableHeight = '0'] = snapshot.split('|')
  return {
    right: Number(right),
    top: Number(top),
    availableWidth: Number(availableWidth),
    availableHeight: Number(availableHeight),
  }
}

function subscribeWorkflowPanelAdjacentPlacement(callback: () => void) {
  /* v8 ignore next 2 -- server/non-browser fallback for a client-only positioning branch. @preserve */
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  window.addEventListener('resize', callback)

  const rightPanel = document.querySelector('[data-workflow-right-panel]')
  const resizeObserver =
    rightPanel && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(callback) : null
  if (rightPanel) resizeObserver?.observe(rightPanel)

  return () => {
    window.removeEventListener('resize', callback)
    resizeObserver?.disconnect()
  }
}

export default function ShortcutsPopupPlugin({
  hotkey = 'Mod+/',
  children,
  className,
  container,
  displayMode = 'selection',
  onOpen,
  onClose,
}: ShortcutPopupPluginProps): React.ReactPortal | null {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)
  const workflowPanelAdjacentPlacementSnapshot = useSyncExternalStore(
    subscribeWorkflowPanelAdjacentPlacement,
    getWorkflowPanelAdjacentPlacementSnapshot,
    () => '0|0|0|0',
  )
  const portalRef = useRef<HTMLDivElement | null>(null)
  const lastSelectionRef = useRef<Range | null>(null)

  /* v8 ignore next -- defensive non-browser fallback; this client-only plugin runs where document exists (browser/test DOM runtime). @preserve */
  const containerEl = useMemo(
    () => container ?? (typeof document !== 'undefined' ? document.body : null),
    [container],
  )
  const useContainer = !!containerEl && containerEl !== document.body

  const { refs, floatingStyles, isPositioned } = useFloating({
    placement: 'bottom-start',
    strategy: useContainer ? 'absolute' : 'fixed',
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
            '--shortcut-popup-max-width': `${Math.min(400, availableWidth)}px`,
            '--shortcut-popup-max-height': `${Math.max(0, availableHeight)}px`,
            overflow: 'visible',
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
    if (!root) return false
    return root.contains(document.activeElement)
  }, [editor])

  const openPortal = useCallback(() => {
    if (displayMode !== 'selection') {
      setOpen(true)
      onOpen?.()
      return
    }

    const domSelection = window.getSelection()
    let range: Range | null = null
    if (domSelection && domSelection.rangeCount > 0) range = domSelection.getRangeAt(0).cloneRange()
    else range = lastSelectionRef.current

    if (range) {
      const rects = range.getClientRects()
      let rect: DOMRect | null = null

      if (rects && rects.length) rect = rects[rects.length - 1]!
      else rect = range.getBoundingClientRect()

      if (rect.width === 0 && rect.height === 0) {
        const root = editor.getRootElement()
        /* v8 ignore next 10 -- zero-size rect recovery depends on browser layout/selection geometry; deterministic reproduction in the test DOM runtime is unreliable. @preserve */
        if (root) {
          const sc = range.startContainer
          const node =
            sc.nodeType === Node.ELEMENT_NODE ? (sc as Element) : sc.parentElement || root

          rect = node.getBoundingClientRect()

          if (rect.width === 0 && rect.height === 0) rect = root.getBoundingClientRect()
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
  }, [displayMode, editor, onOpen, refs])

  const closePortal = useCallback(() => {
    setOpen(false)
    onClose?.()
  }, [onClose])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return
      if (!isEditorFocused()) return

      if (open && event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        closePortal()
        return
      }

      if (matchesKeyboardEvent(event, hotkey)) {
        event.preventDefault()
        event.stopPropagation()
        openPortal()
      }
    }

    return editor.registerRootListener((root, previousRoot) => {
      previousRoot?.removeEventListener('keydown', handleKeyDown, true)
      root?.addEventListener('keydown', handleKeyDown, true)
    })
  }, [editor, hotkey, open, isEditorFocused, openPortal, closePortal])

  useEffect(() => {
    if (!open) return

    const onMouseDown = (e: MouseEvent) => {
      /* v8 ignore next 2 -- outside-click listener can race with ref cleanup during close/unmount; null-ref path is a safety guard. @preserve */
      if (!portalRef.current) return
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-base-ui-portal]')) return
      if (!portalRef.current.contains(e.target as Node)) closePortal()
    }
    document.addEventListener('mousedown', onMouseDown, false)
    return () => document.removeEventListener('mousedown', onMouseDown, false)
  }, [open, closePortal])

  const handleInsert = useCallback(
    <Payload,>(command: LexicalCommand<Payload>, params: Payload) => {
      editor.dispatchCommand(command, params)
      closePortal()
    },
    [editor, closePortal],
  )

  if (!open || !containerEl) return null

  const isFixedPanelAdjacent = displayMode === 'workflow-panel-adjacent-center'
  const fixedPlacementState = parseWorkflowPanelAdjacentPlacement(
    workflowPanelAdjacentPlacementSnapshot,
  )
  const fixedPanelAdjacentStyles: CSSProperties = isFixedPanelAdjacent
    ? ({
        position: 'fixed',
        right: fixedPlacementState.right,
        top: fixedPlacementState.top,
        transform: 'translateY(-50%)',
        zIndex: 50,
        overflow: 'visible',
        visibility: 'visible',
        '--shortcut-popup-max-width': `${Math.min(POPUP_MAX_WIDTH, fixedPlacementState.availableWidth)}px`,
        '--shortcut-popup-max-height': `${fixedPlacementState.availableHeight}px`,
      } as CSSProperties)
    : {}

  return createPortal(
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- The popup delegates Escape dismissal after its nested widgets handle the event.
    <div
      data-testid="shortcuts-popup"
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== 'Escape')
          return
        event.preventDefault()
        event.stopPropagation()
        closePortal()
        editor.focus()
      }}
      ref={(node) => {
        portalRef.current = node
        if (!isFixedPanelAdjacent) refs.setFloating(node)
      }}
      className={cn('absolute rounded-xl bg-components-panel-bg-blur shadow-lg', className)}
      style={
        isFixedPanelAdjacent
          ? fixedPanelAdjacentStyles
          : {
              ...floatingStyles,
              zIndex: useContainer ? undefined : 50,
              overflow: 'visible',
              visibility: isPositioned ? 'visible' : 'hidden',
            }
      }
    >
      <div className="max-h-(--shortcut-popup-max-height) max-w-(--shortcut-popup-max-width) overflow-hidden rounded-xl">
        {typeof children === 'function'
          ? children(closePortal, handleInsert)
          : (children ?? SHORTCUTS_EMPTY_CONTENT)}
      </div>
    </div>,
    containerEl,
  )
}
