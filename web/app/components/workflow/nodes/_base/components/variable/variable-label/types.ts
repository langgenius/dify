import type { ReactNode } from 'react'
import type {
  BlockEnum,
  VarType,
} from '@/app/components/workflow/types'

export type VariablePayload = {
  className?: string
  nodeType?: BlockEnum
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
