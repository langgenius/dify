import type { Node } from './types'
import { useClickAway } from 'ahooks'
import {
  memo,
  useEffect,
  useRef,
} from 'react'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { usePanelInteractions } from './hooks'
import PanelOperatorPopup from './nodes/_base/components/panel-operator/panel-operator-popup'
import { useStore } from './store'

const NodeContextmenu = () => {
  const ref = useRef(null)
  const nodes = useNodes()
  const { handleNodeContextmenuCancel, handlePaneContextmenuCancel } = usePanelInteractions()
  const nodeMenu = useStore(s => s.nodeMenu)
  const currentNode = nodes.find(node => node.id === nodeMenu?.nodeId) as Node
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
      className="absolute z-[9]"
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
