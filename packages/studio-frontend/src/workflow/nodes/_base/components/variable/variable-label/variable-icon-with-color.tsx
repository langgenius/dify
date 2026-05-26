import type { VariableIconProps } from '@/app/components/workflow/nodes/_base/components/variable/variable-label/base/variable-icon'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import VariableIcon from '@/app/components/workflow/nodes/_base/components/variable/variable-label/base/variable-icon'
import { useVarColor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label/hooks'

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
