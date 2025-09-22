import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
} from '@floating-ui/react'
import {
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { MEMORY_POPUP_SHOW_BY_EVENT_EMITTER } from '@/app/components/workflow/nodes/_base/components/prompt/add-memory-button'

import cn from '@/utils/classnames'

export type MemoryPopupProps = {
  className?: string
  container?: Element | null
  instanceId?: string
}

export default function MemoryPopupPlugin({
  className,
  container,
  instanceId,
}: MemoryPopupProps) {
  const [editor] = useLexicalComposerContext()
  const { eventEmitter } = useEventEmitterContextContext()

  const [open, setOpen] = useState(false)
  const portalRef = useRef<HTMLDivElement | null>(null)
  const lastSelectionRef = useRef<Range | null>(null)

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
        rect = rects[rects.length - 1]

      else
        rect = range.getBoundingClientRect()

      if (rect.width === 0 && rect.height === 0) {
        const root = editor.getRootElement()
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
  }, [setOpen])

  const closePortal = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === MEMORY_POPUP_SHOW_BY_EVENT_EMITTER && v.instanceId === instanceId)
      openPortal()
  })

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

  if (!open || !containerEl)
    return null

  return createPortal(
    <div
      ref={(node) => {
        portalRef.current = node
        refs.setFloating(node)
      }}
      className={cn(
        useContainer ? '' : 'z-[999999]',
        'absolute rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm',
        className,
      )}
      style={{
        ...floatingStyles,
        visibility: isPositioned ? 'visible' : 'hidden',
      }}
    >
      Memory Popup
    </div>,
    containerEl,
  )
}
