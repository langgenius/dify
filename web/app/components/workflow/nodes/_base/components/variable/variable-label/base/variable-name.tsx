import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
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
        'truncate system-xs-medium',
        className,
      )}
      title={varName}
    >
      {varName}
    </div>
  )
}

export default memo(VariableName)
