import { memo } from 'react'
import cn from '@/utils/classnames'
import { useVarIcon } from '../hooks'
import type { VarInInspectType } from '@/types/workflow'

export type VariableIconProps = {
  className?: string
  variables?: string[]
  variableCategory?: VarInInspectType | string
  isMemoryVariable?: boolean
}
const VariableIcon = ({
  className,
  variables = [],
  variableCategory,
  isMemoryVariable,
}: VariableIconProps) => {
  const VarIcon = useVarIcon(variables, variableCategory, isMemoryVariable)

  return VarIcon && (
    <VarIcon
      className={cn(
        'size-3.5 shrink-0',
        className,
      )}
    />
  )
}

export default memo(VariableIcon)
