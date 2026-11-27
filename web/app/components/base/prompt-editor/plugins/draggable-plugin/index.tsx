import type { JSX } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin'
import { useEffect, useRef, useState } from 'react'

const DRAGGABLE_BLOCK_MENU_CLASSNAME = 'draggable-block-menu'

function isOnMenu(element: HTMLElement): boolean {
  return !!element.closest(`.${DRAGGABLE_BLOCK_MENU_CLASSNAME}`)
}

const SUPPORT_DRAG_CLASS = 'support-drag'
function checkSupportDrag(element: Element | null): boolean {
  if (!element) return false

  if (element.classList.contains(SUPPORT_DRAG_CLASS)) return true

  if (element.querySelector(`.${SUPPORT_DRAG_CLASS}`)) return true

  return !!element.closest(`.${SUPPORT_DRAG_CLASS}`)
}

export default function DraggableBlockPlugin({
  anchorElem = document.body,
}: {
  anchorElem?: HTMLElement
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const targetLineRef = useRef<HTMLDivElement>(null)
  const [, setDraggableElement] = useState<HTMLElement | null>(null)
  const [editor] = useLexicalComposerContext()

  const [isSupportDrag, setIsSupportDrag] = useState(false)

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      setIsSupportDrag(checkSupportDrag(event.target instanceof Element ? event.target : null))
    }
    const unregister = editor.registerRootListener((root, previousRoot) => {
      previousRoot?.removeEventListener('mousemove', onMove)
      setIsSupportDrag(false)
      root?.addEventListener('mousemove', onMove)
    })
    return () => {
      unregister()
      editor.getRootElement()?.removeEventListener('mousemove', onMove)
    }
  }, [editor])

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElem}
      menuRef={menuRef}
      targetLineRef={targetLineRef}
      menuComponent={
        isSupportDrag ? (
          <div
            ref={menuRef}
            className={cn(
              DRAGGABLE_BLOCK_MENU_CLASSNAME,
              'absolute inset-e-2.5 top-4 cursor-grab opacity-0 will-change-transform active:cursor-move',
            )}
            data-testid="draggable-menu"
          >
            <span
              className="i-ri-draggable size-3.5 text-text-tertiary"
              data-testid="draggable-menu-icon"
            />
          </div>
        ) : null
      }
      targetLineComponent={
        <div
          ref={targetLineRef}
          className="pointer-events-none absolute -inset-s-5.25 top-0 opacity-0 will-change-transform"
          data-testid="draggable-target-line"
          // style={{ width: 500 }} // width not worked here
        >
          <div className="absolute inset-s-0 -inset-e-10 top-0 h-0.5 bg-text-accent-secondary"></div>
        </div>
      }
      isOnMenu={isOnMenu}
      onElementChanged={setDraggableElement}
    />
  )
}
