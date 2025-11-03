import { memo } from 'react'
import VariableIcon from './base/variable-icon'
import type { VariableIconProps } from './base/variable-icon'
import { useVarColor } from './hooks'
import cn from '@/utils/classnames'

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
