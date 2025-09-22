import { memo } from 'react'
import { useVarName } from '../hooks'
import cn from '@/utils/classnames'

type VariableNameProps = {
  variables: string[]
  className?: string
  notShowFullPath?: boolean
}
const VariableName = ({
  variables,
  className,
  notShowFullPath,
}: VariableNameProps) => {
  const varName = useVarName(variables, notShowFullPath)

  return (
    <div
      className={cn(
        'system-xs-medium truncate',
        className,
      )}
      title={varName}
    >
      {varName}
    </div>
  )
}

export default memo(VariableName)
