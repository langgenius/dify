import { ContextMenuContent, ContextMenuItem } from '@langgenius/dify-ui/context-menu'
import { useTranslation } from 'react-i18next'
import { useEdges } from 'reactflow'
import { useEdgesInteractions } from './hooks/use-edges-interactions'
import { useNodesReadOnly } from './hooks/use-workflow'
import { handleWorkflowMenuKeyDown } from './shortcuts/handle-workflow-menu-key-down'
import { ShortcutKbd } from './shortcuts/shortcut-kbd'
import { useStore } from './store'

export function EdgeContextmenu({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common'])
  const contextMenuTarget = useStore((s) => s.contextMenuTarget)
  const edgeId = contextMenuTarget?.type === 'edge' ? contextMenuTarget.edgeId : undefined
  const { handleEdgeDeleteById } = useEdgesInteractions()
  const { getNodesReadOnly } = useNodesReadOnly()
  const edges = useEdges()
  const currentEdgeExists = !edgeId || edges.some((edge) => edge.id === edgeId)

  if (!edgeId || !currentEdgeExists) return null

  const deleteEdge = () => {
    handleEdgeDeleteById(edgeId)
    onClose()
  }

  return (
    <ContextMenuContent
      className="rounded-lg"
      sideOffset={4}
      onKeyDown={(event) => {
        if (getNodesReadOnly()) return
        handleWorkflowMenuKeyDown(event, [['workflow.delete', deleteEdge]])
      }}
    >
      <ContextMenuItem
        variant="destructive"
        className="justify-between gap-4 px-3"
        onClick={deleteEdge}
      >
        <span>{t(($) => $['operation.delete'], { ns: 'common' })}</span>
        <ShortcutKbd shortcut="workflow.delete" />
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
