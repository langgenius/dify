import {
  memo,
  useRef,
} from 'react'
import { useClickAway } from 'ahooks'
import { useNodes } from 'reactflow'
import PanelOperatorPopup from './nodes/_base/components/panel-operator/panel-operator-popup'
import type { Node } from './types'
import {
  useStore,
  useWorkflowStore,
} from './store'

const PanelContextmenu = () => {
  const ref = useRef(null)
  const nodes = useNodes()
  const workflowStore = useWorkflowStore()
  const nodeMenu = useStore(s => s.nodeMenu)
  const currentNode = nodes.find(node => node.id === nodeMenu?.nodeId) as Node

  useClickAway(() => {
    workflowStore.setState({
      nodeMenu: undefined,
    })
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
        onClosePopup={() => {
          workflowStore.setState({
            nodeMenu: undefined,
          })
        }}
      />
    </div>
  )
}

export default memo(PanelContextmenu)
