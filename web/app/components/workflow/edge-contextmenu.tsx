import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges } from 'reactflow'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
} from '@/app/components/base/ui/context-menu'
import { useEdgesInteractions, usePanelInteractions } from './hooks'
import { useStore } from './store'

const EdgeContextmenu = () => {
  const { t } = useTranslation()
  const edgeMenu = useStore(s => s.edgeMenu)
  const { handleEdgeDelete } = useEdgesInteractions()
  const { handleEdgeContextmenuCancel } = usePanelInteractions()
  const edges = useEdges()
  const currentEdgeExists = !edgeMenu || edges.some(edge => edge.id === edgeMenu.edgeId)

  const anchor = useMemo(() => {
    if (!edgeMenu || !currentEdgeExists)
      return null

    return {
      getBoundingClientRect: () => DOMRect.fromRect({
        width: 0,
        height: 0,
        x: edgeMenu.clientX,
        y: edgeMenu.clientY,
      }),
    }
  }, [currentEdgeExists, edgeMenu])

  if (!edgeMenu || !currentEdgeExists || !anchor)
    return null

  return (
    <ContextMenu
      open={!!edgeMenu}
      onOpenChange={open => !open && handleEdgeContextmenuCancel()}
    >
      <ContextMenuContent
        positionerProps={{ anchor }}
        popupClassName="rounded-lg"
      >
        <ContextMenuItem
          destructive
          className="justify-between gap-4 px-3"
          onClick={handleEdgeDelete}
        >
          <span>{t('common:operation.delete')}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default memo(EdgeContextmenu)
