import { memo } from 'react'
import cn from '@/utils/classnames'
import { useVarIcon } from '../hooks'
import type { VarInInspectType } from '@/types/workflow'

export type VariableIconProps = {
  className?: string
  variables?: string[]
  variableCategory?: VarInInspectType | string
}
const VariableIcon = ({
  className,
  variables = [],
  variableCategory,
}: VariableIconProps) => {
  const VarIcon = useVarIcon(variables, variableCategory)

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
