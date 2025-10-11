import {
  memo,
  useEffect,
  useRef,
} from 'react'
import { useClickAway } from 'ahooks'
import PanelOperatorPopup from './nodes/_base/components/panel-operator/panel-operator-popup'
import { useStore } from './store'
import { usePanelInteractions } from './hooks'
import { useFindNode } from '@/app/components/workflow/hooks/use-find-node'

const NodeContextmenu = () => {
  const ref = useRef(null)
  const { handleNodeContextmenuCancel, handlePaneContextmenuCancel } = usePanelInteractions()
  const nodeMenu = useStore(s => s.nodeMenu)
  const currentNode = useFindNode(nodeMenu?.nodeId ? [nodeMenu.nodeId] : [])

  useEffect(() => {
    if (nodeMenu)
      handlePaneContextmenuCancel()
  }, [nodeMenu, handlePaneContextmenuCancel])

  useClickAway(() => {
    handleNodeContextmenuCancel()
  }, ref)

  if (!nodeMenu || !currentNode)
    return null

  return (
    <div
      className='absolute z-[9]'
      style={{
        left: nodeMenu.left,
        top: nodeMenu.top,
      }}
      ref={ref}
    >
      <PanelOperatorPopup
        id={currentNode.id}
        data={currentNode.data}
        onClosePopup={() => handleNodeContextmenuCancel()}
        showHelpLink
      />
    </div>
  )
}

export default memo(NodeContextmenu)
