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
import { hasErrorHandleNode } from '@/app/components/workflow/utils'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'

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
  const edges = useEdges()
  const outgoers = getOutgoers(selectedNode as Node, store.getState().getNodes(), edges)
  const connectedEdges = getConnectedEdges([selectedNode] as Node[], edges).filter(edge => edge.source === selectedNode!.id)

  const list = useMemo(() => {
    let items = []
    if (branches?.length) {
      items = branches.map((branch, index) => {
        const connected = connectedEdges.filter(edge => edge.sourceHandle === branch.id)
        const nextNodes = connected.map(edge => outgoers.find(outgoer => outgoer.id === edge.target)!)

        return {
          branch: {
            ...branch,
            name: data.type === BlockEnum.QuestionClassifier ? `${t('workflow.nodes.questionClassifiers.class')} ${index + 1}` : branch.name,
          },
          nextNodes,
        }
      })
    }
    else {
      const connected = connectedEdges.filter(edge => edge.sourceHandle === 'source')
      const nextNodes = connected.map(edge => outgoers.find(outgoer => outgoer.id === edge.target)!)

      items = [{
        branch: {
          id: '',
          name: '',
        },
        nextNodes,
      }]

      if (data.error_strategy === ErrorHandleTypeEnum.failBranch && hasErrorHandleNode(data.type)) {
        const connected = connectedEdges.filter(edge => edge.sourceHandle === ErrorHandleTypeEnum.failBranch)
        const nextNodes = connected.map(edge => outgoers.find(outgoer => outgoer.id === edge.target)!)

        items.push({
          branch: {
            id: ErrorHandleTypeEnum.failBranch,
            name: t('workflow.common.onFailure'),
          },
          nextNodes,
        })
      }
    }

    return items
  }, [branches, connectedEdges, data.error_strategy, data.type, outgoers, t])

  return (
    <div className='flex py-1'>
      <div className='bg-background-default border-divider-regular shadow-xs relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[0.5px]'>
        <BlockIcon
          type={selectedNode!.data.type}
          toolIcon={toolIcon}
        />
      </div>
      <Line
        list={list.length ? list.map(item => item.nextNodes.length + 1) : [1]}
      />
      <div className='grow space-y-2'>
        {
          list.map((item, index) => {
            return (
              <Container
                key={index}
                nodeId={selectedNode!.id}
                nodeData={selectedNode!.data}
                sourceHandle={item.branch.id}
                nextNodes={item.nextNodes}
                branchName={item.branch.name}
                isFailBranch={item.branch.id === ErrorHandleTypeEnum.failBranch}
              />
            )
          })
        }
      </div>
    </div>
  )
}

export default memo(NextStep)
