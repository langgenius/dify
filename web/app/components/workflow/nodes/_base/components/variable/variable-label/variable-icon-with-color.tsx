import type { VariableIconProps } from './base/variable-icon'
import { memo } from 'react'
import { cn } from '@/utils/classnames'
import VariableIcon from './base/variable-icon'
import { useVarColor } from './hooks'

type VariableIconWithColorProps = {
  isExceptionVariable?: boolean
} & VariableIconProps

const VariableIconWithColor = ({
  isExceptionVariable,
  variableCategory,
  variables = [],
  className,
}: VariableIconWithColorProps) => {
  const varColorClassName = useVarColor(variables, isExceptionVariable, variableCategory)
  return (
    <VariableIcon
      variables={variables}
      variableCategory={variableCategory}
      className={cn(
        varColorClassName,
        className,
      )}
    />
  )
}

export default memo(VariableIconWithColor)
