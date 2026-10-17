import type { ReactNode } from 'react'
import type { NodeDataType, VarType } from '@/app/components/workflow/types'

export type VariablePayload = {
  className?: string
  nodeType?: NodeDataType
  nodeTitle?: string
  variables: string[]
  variableType?: VarType
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  errorMsg?: string
  isExceptionVariable?: boolean
  ref?: React.Ref<HTMLDivElement>
  notShowFullPath?: boolean
  rightSlot?: ReactNode
}
