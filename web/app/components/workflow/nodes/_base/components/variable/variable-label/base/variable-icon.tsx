import type { VarInInspectType } from '@/types/workflow'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { getVarIconClass } from '../hooks'

export type VariableIconProps = {
  className?: string
  variables?: string[]
  variableCategory?: VarInInspectType | string
}
const VariableIcon = ({ className, variables = [], variableCategory }: VariableIconProps) => {
  const iconClassName = getVarIconClass(variables, variableCategory)

  return <span aria-hidden className={cn(iconClassName, 'size-3.5 shrink-0', className)} />
}

export default memo(VariableIcon)
