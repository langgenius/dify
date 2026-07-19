import type { ComponentProps } from 'react'
import type { NodePanelProps, NodeProps } from '@/app/components/workflow/types'
import { createElement } from 'react'
import { HumanInputV2Node } from './human-input-v2/node'
import { HumanInputV2Panel } from './human-input-v2/panel'
import { isHumanInputV2NodeData } from './human-input-v2/types'
import HumanInputNode from './human-input/node'
import HumanInputPanel from './human-input/panel'

type WorkflowHumanInputNodeProps = NodeProps
type WorkflowHumanInputPanelProps = NodePanelProps<unknown>

export function WorkflowHumanInputNode(props: WorkflowHumanInputNodeProps) {
  if (isHumanInputV2NodeData(props.data))
    return createElement(HumanInputV2Node, props as ComponentProps<typeof HumanInputV2Node>)

  return createElement(HumanInputNode, props as ComponentProps<typeof HumanInputNode>)
}

export function WorkflowHumanInputPanel(props: WorkflowHumanInputPanelProps) {
  if (isHumanInputV2NodeData(props.data))
    return createElement(HumanInputV2Panel, props as ComponentProps<typeof HumanInputV2Panel>)

  return createElement(HumanInputPanel, props as ComponentProps<typeof HumanInputPanel>)
}
