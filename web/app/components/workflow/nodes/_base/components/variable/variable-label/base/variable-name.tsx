import { memo } from 'react'
import { cn } from '@/utils/classnames'
import { useVarName } from '../hooks'

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
