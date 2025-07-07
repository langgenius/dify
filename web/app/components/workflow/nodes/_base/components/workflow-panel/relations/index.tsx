import { memo } from 'react'
import { isEqual } from 'lodash-es'
import {
  getOutgoers,
  useStore,
} from 'reactflow'
import { useToolIcon } from '@/app/components/workflow/hooks'
import BlockIcon from '@/app/components/workflow/block-icon'
import type {
  Node,
} from '@/app/components/workflow/types'
import Line from './line'
import Container from './container'
import { getNodeUsedVars } from '../../variable/utils'
import { RelationType } from './types'

type RelationsProps = {
  selectedNode: Node
  relationType: RelationType
}
const Relations = ({
  selectedNode,
  relationType,
}: RelationsProps) => {
  const data = selectedNode.data
  const toolIcon = useToolIcon(data)
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
  const workflowNodes = useStore(s => s.getNodes())

  const list: Node[] = []

  if (relationType === RelationType.dependencies) {
    const usedVars = getNodeUsedVars(selectedNode)
    const dependencyNodes: Node[] = []
    usedVars.forEach((valueSelector) => {
      const node = workflowNodes.find(node => node.id === valueSelector?.[0])
      if (node) {
        if (!dependencyNodes.includes(node))
          dependencyNodes.push(node)
      }
    })
    list.push(...dependencyNodes)
  }
  else {
    const outgoers = getOutgoers(selectedNode as Node, nodes as Node[], edges)
    for (let currIdx = 0; currIdx < outgoers.length; currIdx++) {
      const node = outgoers[currIdx]
      const outgoersForNode = getOutgoers(node, nodes as Node[], edges)
      outgoersForNode.forEach((item) => {
        const existed = outgoers.some(v => v.id === item.id)
        if (!existed)
          outgoers.push(item)
      })
    }

    const dependentNodes: Node[] = []
    outgoers.forEach((node) => {
      const usedVars = getNodeUsedVars(node)
      const used = usedVars.some(v => v?.[0] === selectedNode.id)
      if (used) {
        const existed = dependentNodes.some(v => v.id === node.id)
        if (!existed)
          dependentNodes.push(node)
      }
    })
    list.push(...dependentNodes)
  }

  const getThisNode = () => {
    return (
      <div className='relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-background-default shadow-xs'>
        <BlockIcon
          type={selectedNode!.data.type}
          toolIcon={toolIcon}
        />
      </div>
    )
  }

  const getLinkedNodes = () => {
    return (
      <div className='grow space-y-2'>
        {list.length > 0 ? (
          list.map((item, index) => {
            return (
              <Container
                key={index}
                nextNode={item}
              />
            )
          })
        ) : (
          <Container key={0} />
        )}
      </div>
    )
  }

  return (
    <div className='flex py-1'>
      {getThisNode()}
      <Line
        rowCount={Math.max(1, list.length)}
        relationType={relationType}
      />
      {getLinkedNodes()}
    </div>
  )
}

export default memo(Relations)
