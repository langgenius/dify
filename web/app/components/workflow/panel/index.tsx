import type { FC } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import { useNodes } from 'reactflow'
import { useWorkflowContext } from '../context'
import { Panel as NodePanel } from '../nodes'
import { useStore } from '../store'
import WorkflowInfo from './workflow-info'
import DebugAndPreview from './debug-and-preview'

const Panel: FC = () => {
  const {
    mode,
  } = useWorkflowContext()
  const nodes = useNodes()
  const selectedNodeId = useStore(state => state.selectedNodeId)
  const selectedNode = useMemo(() => {
    return nodes.find(node => node.id === selectedNodeId)
  }, [nodes, selectedNodeId])
  const {
    showWorkflowInfoPanel,
    showNodePanel,
    showDebugAndPreviewPanel,
  } = useMemo(() => {
    return {
      showWorkflowInfoPanel: mode === 'workflow' && !selectedNode,
      showNodePanel: selectedNode,
      showDebugAndPreviewPanel: mode === 'chatbot' && !selectedNode,
    }
  }, [mode, selectedNode])

  return (
    <div className='absolute top-14 right-0 bottom-2 flex'>
      {
        showNodePanel && (
          <NodePanel node={selectedNode as any} />
        )
      }
      {
        showWorkflowInfoPanel && (
          <WorkflowInfo />
        )
      }
      {
        showDebugAndPreviewPanel && (
          <DebugAndPreview />
        )
      }
    </div>
  )
}

export default memo(Panel)
