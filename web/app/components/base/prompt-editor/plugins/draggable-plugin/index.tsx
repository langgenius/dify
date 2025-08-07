import type { JSX } from 'react'

import './index.css'

import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin'
import { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

const DRAGGABLE_BLOCK_MENU_CLASSNAME = 'draggable-block-menu'

function isOnMenu(element: HTMLElement): boolean {
  return !!element.closest(`.${DRAGGABLE_BLOCK_MENU_CLASSNAME}`)
}

const SUPPORT_DRAG_CLASS = 'support-drag'
function checkSupportDrag(element: Element | null): boolean {
  if (!element) return false

  if (element.classList.contains(SUPPORT_DRAG_CLASS)) return true

  if (element.querySelector(`.${SUPPORT_DRAG_CLASS}`)) return true

  return !!(element.closest(`.${SUPPORT_DRAG_CLASS}`))
}

export default function DraggableBlockPlugin({
  anchorElem = document.body,
}: {
  anchorElem?: HTMLElement;
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const targetLineRef = useRef<HTMLDivElement>(null)
  const [draggableElement, setDraggableElement] = useState<HTMLElement | null>(
    null,
  )
const [editor] = useLexicalComposerContext()

  const [isSupportDrag, setIsSupportDrag] = useState(false)

  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return

    const onMove = (e: MouseEvent) => {
      const isSupportDrag = checkSupportDrag(e.target as Element)
      setIsSupportDrag(isSupportDrag)
    }

    root.addEventListener('mousemove', onMove)
    return () => root.removeEventListener('mousemove', onMove)
  }, [editor])

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElem}
      menuRef={menuRef as any}
      targetLineRef={targetLineRef as any}
      menuComponent={
        isSupportDrag ? <div ref={menuRef} className="icon draggable-block-menu">
          <div className="icon" />
        </div> : null
      }
      targetLineComponent={
        <div ref={targetLineRef} className="draggable-block-target-line" />
      }
      isOnMenu={isOnMenu}
      onElementChanged={setDraggableElement}
    />
  )
}
