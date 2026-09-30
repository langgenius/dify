import type { ComponentProps } from 'react'
import type { NodeProps } from '@/app/components/workflow/types'
import { createElement } from 'react'
import { HumanInputV2Node } from './human-input-v2/node'
import { isHumanInputV2NodeData } from './human-input-v2/types'
import HumanInputNode from './human-input/node'

type WorkflowHumanInputNodeProps = NodeProps

export function WorkflowHumanInputNode(props: WorkflowHumanInputNodeProps) {
  if (isHumanInputV2NodeData(props.data))
    return createElement(HumanInputV2Node, props as ComponentProps<typeof HumanInputV2Node>)

  return createElement(HumanInputNode, props as ComponentProps<typeof HumanInputNode>)
}
