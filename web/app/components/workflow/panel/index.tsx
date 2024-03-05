import type { FC } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import { useNodes } from 'reactflow'
import type { CommonNodeType } from '../types'
import { Panel as NodePanel } from '../nodes'
import { useStore } from '../store'
import WorkflowInfo from './workflow-info'
import DebugAndPreview from './debug-and-preview'
import RunHistory from './run-history'
import Record from './record'
import { useStore as useAppStore } from '@/app/components/app/store'

const Panel: FC = () => {
  const appDetail = useAppStore(state => state.appDetail)
  const runStaus = useStore(state => state.runStaus)
  const nodes = useNodes<CommonNodeType>()
  const selectedNode = nodes.find(node => node.data._selected)
  const showRunHistory = useStore(state => state.showRunHistory)
  const {
    showWorkflowInfoPanel,
    showNodePanel,
    showDebugAndPreviewPanel,
  } = useMemo(() => {
    return {
      showWorkflowInfoPanel: appDetail?.mode === 'workflow' && !selectedNode,
      showNodePanel: !!selectedNode,
      showDebugAndPreviewPanel: appDetail?.mode === 'advanced-chat' && !selectedNode,
    }
  }, [selectedNode, appDetail])

  return (
    <div className='absolute top-14 right-0 bottom-2 flex z-10'>
      {
        runStaus && (
          <Record />
        )
      }
      {
        showNodePanel && (
          <NodePanel {...selectedNode!} />
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
      {
        showRunHistory && (
          <RunHistory />
        )
      }
    </div>
  )
}

export default memo(Panel)
