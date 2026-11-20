import type { CSSProperties } from 'react'
import type { NodeEditor } from '../utils/node-editors'
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@langgenius/dify-ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { getAvatarInitial } from '@/utils/avatar'

type NodeEditorAvatarsProps = {
  editors: NodeEditor[]
  maxVisible?: number
}

export const NodeEditorAvatars = ({ editors, maxVisible = 3 }: NodeEditorAvatarsProps) => {
  const { t } = useTranslation(['workflow'])
  if (!editors.length) return null

  const hasOverflow = editors.length > maxVisible
  const visibleEditors = editors.slice(0, hasOverflow ? maxVisible - 1 : maxVisible)
  const overflowEditors = editors.slice(visibleEditors.length)

  return (
    <AvatarGroup size="xs">
      {visibleEditors.map((editor, index) => {
        const label = t(($) => $['collaboration.userEditing'], {
          ns: 'workflow',
          name: editor.name,
        })
        return (
          <Tooltip key={editor.id}>
            <TooltipTrigger
              render={
                <Avatar
                  role="img"
                  aria-label={label}
                  style={{ zIndex: visibleEditors.length - index }}
                />
              }
            >
              <AvatarFallback style={{ backgroundColor: editor.color }}>
                {getAvatarInitial(editor.name)}
              </AvatarFallback>
              <AvatarImage src={editor.avatarUrl || undefined} alt="" />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        )
      })}
      {overflowEditors.length > 0 && (
        <AvatarGroupCount
          role="img"
          aria-label={overflowEditors
            .map((editor) =>
              t(($) => $['collaboration.userEditing'], { ns: 'workflow', name: editor.name }),
            )
            .join(', ')}
        >
          +{overflowEditors.length}
        </AvatarGroupCount>
      )}
    </AvatarGroup>
  )
}

const TAG_WING_PATH =
  'M0 0H20C14 0 10.2145 0.0311351 8.5 5.3125C7.49899 8.32587 6.62902 11.0665 5.70732 13.3873C4.79269 15.6904 2.47801 17 0 17V0Z'

const TagWing = ({ className }: { className?: string }) => (
  <svg aria-hidden width="20" height="17" viewBox="0 0 20 17" className={className}>
    <path d={TAG_WING_PATH} fill="currentColor" />
  </svg>
)

/**
 * Outlines the node panel in the latest editor's color and hangs a
 * "{name} is editing" tag from its top edge. Render inside a relative,
 * rounded panel container.
 */
export const NodePanelEditingFrame = ({ editor }: { editor: NodeEditor | undefined }) => {
  const { t } = useTranslation(['workflow'])
  if (!editor) return null

  return (
    <div
      data-testid="node-panel-editing-frame"
      className="pointer-events-none absolute inset-0 z-20 rounded-2xl border-2 border-(--editor-color)"
      style={{ '--editor-color': editor.color } as CSSProperties}
    >
      <div className="absolute -top-0.5 left-1/2 flex -translate-x-1/2 items-end text-(--editor-color)">
        <TagWing className="shrink-0 -scale-x-100" />
        <span className="max-w-50 truncate bg-(--editor-color) pt-0.75 pb-1 system-2xs-medium text-text-primary-on-surface">
          {t(($) => $['collaboration.userEditing'], { ns: 'workflow', name: editor.name })}
        </span>
        <TagWing className="shrink-0" />
      </div>
    </div>
  )
}
