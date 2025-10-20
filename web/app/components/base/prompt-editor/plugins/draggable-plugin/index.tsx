import type { JSX } from 'react'
import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin'
import { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RiDraggable } from '@remixicon/react'
import cn from '@/utils/classnames'

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
  const [, setDraggableElement] = useState<HTMLElement | null>(
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
        isSupportDrag ? <div ref={menuRef} className={cn(DRAGGABLE_BLOCK_MENU_CLASSNAME, 'absolute right-[24px] top-[16px] cursor-grab opacity-0 will-change-transform active:cursor-move')}>
          <RiDraggable className='size-3.5 text-text-tertiary' />
        </div> : null
      }
      targetLineComponent={
        <div
          ref={targetLineRef}
          className="pointer-events-none absolute left-[-21px] top-0 opacity-0 will-change-transform"
          // style={{ width: 500 }} // width not worked here
        >
          <div
            className='absolute left-0 right-[-40px] top-0 h-[2px] bg-text-accent-secondary'
          ></div>
        </div>
      }
      isOnMenu={isOnMenu}
      onElementChanged={setDraggableElement}
    />
  )
}
