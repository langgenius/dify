import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey, $getRoot, SKIP_DOM_SELECTION_TAG } from 'lexical'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type SortSession = { blockKey: string; position: number; initialPosition: number; count: number }

// Only HITL blocks expose this control. Like Lexical's pointer drag plugin, it
// moves the containing top-level block, including any text in that block.
export default function KeyboardSortButton({ nodeKey, name }: { nodeKey: string; name: string }) {
  const [editor] = useLexicalComposerContext()
  const { t } = useTranslation('common')
  const descriptionId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [session, setSession] = useState<SortSession | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const describe = (action: 'started' | 'finished' | 'cancelled' | 'target', value: SortSession) =>
    t(($) => $[`sort.${action}`], {
      ns: 'common',
      item: name,
      position: value.position + 1,
      count: value.count,
    })

  const cancel = () => {
    if (!session) return
    setAnnouncement(describe('cancelled', { ...session, position: session.initialPosition }))
    setSession(null)
  }

  const activate = () => {
    if (!editor.isEditable()) return
    if (!session) {
      editor.getEditorState().read(() => {
        const block = $getNodeByKey(nodeKey)?.getTopLevelElement()
        if (!block) return
        const blocks = $getRoot().getChildren()
        const value = {
          blockKey: block.getKey(),
          position: blocks.indexOf(block),
          initialPosition: blocks.indexOf(block),
          count: blocks.length,
        }
        setSession(value)
        setAnnouncement(describe('started', value))
      })
      return
    }

    // Preview is local: only confirmation changes the document and triggers
    // the editor's existing save pipeline. Cancellation never restores text.
    editor.update(
      () => {
        const block = $getNodeByKey(session.blockKey)
        if (!block || block.getParent() !== $getRoot()) return
        const blocks = $getRoot().getChildren()
        const index = blocks.indexOf(block)
        const target = blocks[Math.min(session.position, blocks.length - 1)]
        if (!target || target === block) return
        if (index < session.position) target.insertAfter(block)
        else target.insertBefore(block)
      },
      {
        tag: SKIP_DOM_SELECTION_TAG,
        onUpdate: () => buttonRef.current?.focus(),
      },
    )
    setAnnouncement(describe('finished', session))
    setSession(null)
  }

  return (
    <>
      <IconButton
        ref={buttonRef}
        aria-label={t(($) => $['sort.handle'], { ns: 'common', item: name })}
        aria-describedby={descriptionId}
        aria-pressed={!!session}
        className="pointer-events-none sr-only focus:pointer-events-auto focus:not-sr-only focus:absolute focus:top-3 focus:right-0 focus:z-10"
        onClickCapture={(event) => {
          event.stopPropagation()
          activate()
        }}
        onBlur={cancel}
        onKeyDownCapture={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            if (!event.repeat) activate()
            return
          }
          if (!session) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancel()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            const position = Math.max(
              0,
              Math.min(session.count - 1, session.position + (event.key === 'ArrowUp' ? -1 : 1)),
            )
            const next = { ...session, position }
            setSession(next)
            setAnnouncement(describe('target', next))
          }
        }}
      >
        <span aria-hidden="true" className="i-ri-draggable size-4" />
      </IconButton>
      <span id={descriptionId} className="sr-only">
        {t(($) => $['sort.instructions'], { ns: 'common' })}
      </span>
      <span role="status" className={session ? 'block text-xs text-text-secondary' : 'sr-only'}>
        {session ? describe('target', session) : announcement}
      </span>
    </>
  )
}
