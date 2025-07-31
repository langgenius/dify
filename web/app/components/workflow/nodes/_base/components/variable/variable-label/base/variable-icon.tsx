import { memo } from 'react'
import cn from '@/utils/classnames'
import { useVarIcon } from '../hooks'

type VariableIconProps = {
  className?: string
  variables: string[]
}
const VariableIcon = ({
  className,
  variables,
}: VariableIconProps) => {
  const VarIcon = useVarIcon(variables)

  return (
    <VarIcon
      className={cn(
        'size-3.5 shrink-0',
        className,
      )}
    />
  )
}

export default memo(VariableIcon)
