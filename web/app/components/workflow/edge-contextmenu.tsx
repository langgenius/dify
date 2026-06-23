import {
  ContextMenuContent,
  ContextMenuItem,
} from '@langgenius/dify-ui/context-menu'
import { useTranslation } from '#i18n'
import { useEdges } from 'reactflow'
import { useEdgesInteractions } from './hooks'
import { ShortcutKbd } from './shortcuts/shortcut-kbd'
import { useStore } from './store'

export function EdgeContextmenu({
  onClose,
}: {
  onClose: () => void
}) {
  const { t } = useTranslation()
  const contextMenuTarget = useStore(s => s.contextMenuTarget)
  const edgeId = contextMenuTarget?.type === 'edge' ? contextMenuTarget.edgeId : undefined
  const { handleEdgeDeleteById } = useEdgesInteractions()
  const edges = useEdges()
  const currentEdgeExists = !edgeId || edges.some(edge => edge.id === edgeId)

  if (!edgeId || !currentEdgeExists)
    return null

  return (
    <ContextMenuContent
      popupClassName="rounded-lg"
      sideOffset={4}
    >
      <ContextMenuItem
        variant="destructive"
        className="justify-between gap-4 px-3"
        onClick={() => {
          handleEdgeDeleteById(edgeId)
          onClose()
        }}
      >
        <span>{t('common:operation.delete')}</span>
        <ShortcutKbd shortcut="workflow.delete" />
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
