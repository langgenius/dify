import type { SubGraphProps } from '@/app/components/sub-graph/types'
import type { ValueSelector } from '@/app/components/workflow/types'

type BaseSubGraphModalProps = {
  isOpen: boolean
  onClose: () => void
  toolNodeId: string
  paramKey: string
  pendingSingleRun?: boolean
  onPendingSingleRunHandled?: () => void
}

type AgentSubGraphModalProps = BaseSubGraphModalProps & {
  variant: 'agent'
  sourceVariable: ValueSelector
  agentName: string
  agentNodeId: string
}

type AssembleSubGraphModalProps = BaseSubGraphModalProps & {
  variant: 'assemble'
  title: string
}

export type SubGraphModalProps = AgentSubGraphModalProps | AssembleSubGraphModalProps

export type SubGraphCanvasProps = SubGraphProps
