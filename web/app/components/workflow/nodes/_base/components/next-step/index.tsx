import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getConnectedEdges,
  getOutgoers,
  useEdges,
  useStoreApi,
} from 'reactflow'
import { useToolIcon } from '../../../../hooks'
import BlockIcon from '../../../../block-icon'
import type {
  Node,
} from '../../../../types'
import { BlockEnum } from '../../../../types'
import Line from './line'
import Container from './container'

type NextStepProps = {
  selectedNode: Node
}
const NextStep = ({
  selectedNode,
}: NextStepProps) => {
  const { t } = useTranslation()
  const data = selectedNode.data
  const toolIcon = useToolIcon(data)
  const store = useStoreApi()
  const branches = useMemo(() => {
    return data._targetBranches || []
  }, [data])
  const nodeWithBranches = data.type === BlockEnum.IfElse || data.type === BlockEnum.QuestionClassifier
  const edges = useEdges()
  const outgoers = getOutgoers(selectedNode as Node, store.getState().getNodes(), edges)
  const connectedEdges = getConnectedEdges([selectedNode] as Node[], edges).filter(edge => edge.source === selectedNode!.id)

  const branchesOutgoers = useMemo(() => {
    if (!branches?.length)
      return []

    return branches.map((branch) => {
      const connected = connectedEdges.filter(edge => edge.sourceHandle === branch.id)
      const nextNodes = connected.map(edge => outgoers.find(outgoer => outgoer.id === edge.target)!)

      return {
        branch,
        nextNodes,
      }
    })
  }, [branches, connectedEdges, outgoers])

  return (
    <div className='flex py-1'>
      <div className='shrink-0 relative flex items-center justify-center w-9 h-9 bg-background-default rounded-lg border-[0.5px] border-divider-regular shadow-xs'>
        <BlockIcon
          type={selectedNode!.data.type}
          toolIcon={toolIcon}
        />
      </div>
      <Line
        list={nodeWithBranches ? branchesOutgoers.map(item => item.nextNodes.length + 1) : [1]}
      />
      <div className='grow space-y-2'>
        {
          !nodeWithBranches && (
            <Container
              nodeId={selectedNode!.id}
              nodeData={selectedNode!.data}
              sourceHandle='source'
              nextNodes={outgoers}
            />
          )
        }
        {
          nodeWithBranches && (
            branchesOutgoers.map((item, index) => {
              return (
                <Container
                  key={item.branch.id}
                  nodeId={selectedNode!.id}
                  nodeData={selectedNode!.data}
                  sourceHandle={item.branch.id}
                  nextNodes={item.nextNodes}
                  branchName={item.branch.name || `${t('workflow.nodes.questionClassifiers.class')} ${index + 1}`}
                />
              )
            })
          )
        }
      </div>
    </div>
  )
}

export default memo(NextStep)
