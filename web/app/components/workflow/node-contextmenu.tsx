import {
  memo,
  useEffect,
  useRef,
} from 'react'
import { useClickAway } from 'ahooks'
import { useNodes } from 'reactflow'
import PanelOperatorPopup from './nodes/_base/components/panel-operator/panel-operator-popup'
import type { Node } from './types'
import { useStore } from './store'
import { usePanelInteractions } from './hooks'

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
