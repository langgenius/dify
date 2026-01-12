import type { ValueSelector } from '@/app/components/workflow/types'

export type SubGraphModalProps = {
  isOpen: boolean
  onClose: () => void
  toolNodeId: string
  paramKey: string
  sourceVariable: ValueSelector
  agentName: string
  agentNodeId: string
}

export type SubGraphCanvasProps = {
  toolNodeId: string
  paramKey: string
  sourceVariable: ValueSelector
  agentNodeId: string
  agentName: string
}
