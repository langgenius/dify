import type {
  Node,
} from '../../../../types'
import { isEqual } from 'es-toolkit/predicate'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getConnectedEdges,
  getOutgoers,
  useStore,
} from 'reactflow'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { hasErrorHandleNode } from '@/app/components/workflow/utils'
import BlockIcon from '../../../../block-icon'
import { useToolIcon } from '../../../../hooks'
import { BlockEnum } from '../../../../types'
import Container from './container'
import Line from './line'

type NextStepProps = {
  selectedNode: Node
}
const NextStep = ({
  selectedNode,
}: NextStepProps) => {
  const { t } = useTranslation()
  const data = selectedNode.data
  const toolIcon = useToolIcon(data)
  const branches = useMemo(() => {
    return data._targetBranches || []
  }, [data])
  const edges = useStore(s => s.edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
  })), isEqual)
  const nodes = useStore(s => s.getNodes().map(node => ({
    id: node.id,
    data: node.data,
  })), isEqual)
  const outgoers = getOutgoers(selectedNode as Node, nodes as Node[], edges)
  const connectedEdges = getConnectedEdges([selectedNode] as Node[], edges).filter(edge => edge.source === selectedNode!.id)

  const list = useMemo(() => {
    const resolveNextNodes = (connected: typeof connectedEdges) => {
      return connected.reduce<Node[]>((acc, edge) => {
        const nextNode = outgoers.find(outgoer => outgoer.id === edge.target)
        if (nextNode)
          acc.push(nextNode)
        return acc
      }, [])
    }
    let items = []
    if (branches?.length) {
      items = branches.map((branch, index) => {
        const connected = connectedEdges.filter(edge => edge.sourceHandle === branch.id)
        const nextNodes = resolveNextNodes(connected)

        return {
          branch: {
            ...branch,
            name: data.type === BlockEnum.QuestionClassifier ? `${t('nodes.questionClassifiers.class', { ns: 'workflow' })} ${index + 1}` : branch.name,
          },
          nextNodes,
        }
      })
    }
    else {
      const connected = connectedEdges.filter(edge => edge.sourceHandle === 'source')
      const nextNodes = resolveNextNodes(connected)

      items = [{
        branch: {
          id: '',
          name: '',
        },
        nextNodes,
      }]

      if (data.error_strategy === ErrorHandleTypeEnum.failBranch && hasErrorHandleNode(data.type)) {
        const connected = connectedEdges.filter(edge => edge.sourceHandle === ErrorHandleTypeEnum.failBranch)
        const nextNodes = resolveNextNodes(connected)

        items.push({
          branch: {
            id: ErrorHandleTypeEnum.failBranch,
            name: t('common.onFailure', { ns: 'workflow' }),
          },
          nextNodes,
        })
      }
    }

    return items
  }, [branches, connectedEdges, data.error_strategy, data.type, outgoers, t])

  return (
    <div className="flex py-1">
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-background-default shadow-xs">
        <BlockIcon
          type={selectedNode!.data.type}
          toolIcon={toolIcon}
        />
      </div>
      <Line
        list={list.length ? list.map(item => item.nextNodes.length + 1) : [1]}
      />
      <div className="grow space-y-2">
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
