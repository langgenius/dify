import type { CSSProperties } from 'react'
import type { Collaborator } from './collaborator-avatar'
import { AvatarGroup, AvatarGroupCount } from '@langgenius/dify-ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { CollaboratorAvatar } from './collaborator-avatar'

type NodeEditorAvatarsProps = {
  editors: Collaborator[]
  maxVisible?: number
}

/**
 * Avatars of the other people editing a node. Each one is focusable so its
 * "{name} is editing" tooltip opens from the keyboard as well as on hover.
 */
export function NodeEditorAvatars({ editors, maxVisible = 3 }: NodeEditorAvatarsProps) {
  const { t } = useTranslation(['workflow'])
  if (!editors.length) return null

  const hasOverflow = editors.length > maxVisible
  const visibleEditors = editors.slice(0, hasOverflow ? Math.max(1, maxVisible - 1) : maxVisible)
  const overflowEditors = editors.slice(visibleEditors.length)
  const editingLabel = (name: string) =>
    t(($) => $['collaboration.userEditing'], { ns: 'workflow', name })

  return (
    <AvatarGroup size="xs">
      {visibleEditors.map((editor) => (
        <Tooltip key={editor.id}>
          <TooltipTrigger
            render={
              <CollaboratorAvatar
                collaborator={editor}
                role="img"
                aria-hidden={undefined}
                aria-label={editingLabel(editor.name)}
                tabIndex={0}
                className="focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              />
            }
          />
          <TooltipContent>{editingLabel(editor.name)}</TooltipContent>
        </Tooltip>
      ))}
      {overflowEditors.length > 0 && (
        <AvatarGroupCount
          role="img"
          aria-label={overflowEditors.map((editor) => editingLabel(editor.name)).join(', ')}
        >
          +{overflowEditors.length}
        </AvatarGroupCount>
      )}
    </AvatarGroup>
  )
}

const TAG_WING_PATH =
  'M0 0H20C14 0 10.2145 0.0311351 8.5 5.3125C7.49899 8.32587 6.62902 11.0665 5.70732 13.3873C4.79269 15.6904 2.47801 17 0 17V0Z'

function TagWing({ className }: { className?: string }) {
  return (
    <svg aria-hidden width="20" height="17" viewBox="0 0 20 17" className={className}>
      <path d={TAG_WING_PATH} fill="currentColor" />
    </svg>
  )
}

type NodePanelEditingFrameProps = {
  editor: Pick<Collaborator, 'name' | 'color'> | undefined
}

/**
 * Outlines a node panel in the editor's color and hangs a "{name} is editing"
 * tag from its top edge. Render inside a relative, rounded-2xl panel.
 */
export function NodePanelEditingFrame({ editor }: NodePanelEditingFrameProps) {
  const { t } = useTranslation(['workflow'])
  if (!editor) return null

  return (
    <div
      data-testid="node-panel-editing-frame"
      className="pointer-events-none absolute inset-0 z-20 rounded-2xl border-2 border-(--editor-color)"
      style={{ '--editor-color': editor.color } as CSSProperties}
    >
      <div className="absolute -top-0.5 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-end text-(--editor-color)">
        <TagWing className="shrink-0 -scale-x-100" />
        <span className="min-w-0 truncate bg-(--editor-color) pt-0.75 pb-1 system-2xs-medium text-text-primary-on-surface">
          {t(($) => $['collaboration.userEditing'], { ns: 'workflow', name: editor.name })}
        </span>
        <TagWing className="shrink-0" />
      </div>
    </div>
  )
}
