import type { VariablePayload } from '../types'
import { capitalize } from 'es-toolkit/string'
import { memo } from 'react'
import { Warning } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { cn } from '@/utils/classnames'
import { isConversationVar, isENV, isGlobalVar, isRagVariableVar } from '../../utils'
import { useVarColor } from '../hooks'
import VariableIcon from './variable-icon'
import VariableName from './variable-name'
import VariableNodeLabel from './variable-node-label'

const VariableLabel = ({
  nodeType,
  nodeTitle,
  variables,
  variableType,
  className,
  errorMsg,
  onClick,
  isExceptionVariable,
  ref,
  notShowFullPath,
  rightSlot,
}: VariablePayload) => {
  const varColorClassName = useVarColor(variables, isExceptionVariable)
  const isShowNodeLabel = !(isENV(variables) || isConversationVar(variables) || isGlobalVar(variables) || isRagVariableVar(variables))

  const badge = (
    <div
      className={cn(
        'inline-flex h-6 max-w-full items-center space-x-0.5 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark px-1.5 shadow-xs',
        className,
      )}
      onClick={onClick}
      ref={ref}
      {...(isExceptionVariable ? { 'data-testid': 'exception-variable' } : {})}
    >
      {isShowNodeLabel && (
        <VariableNodeLabel
          nodeType={nodeType}
          nodeTitle={nodeTitle}
        />
      )}
      {
        notShowFullPath && (
          <>
            <span className="i-ri-more-line h-3 w-3 shrink-0 text-text-secondary" />
            <div className="shrink-0 text-divider-deep system-xs-regular">/</div>
          </>
        )
      }
      <VariableIcon
        variables={variables}
        className={varColorClassName}
      />
      <VariableName
        variables={variables}
        className={cn(varColorClassName)}
        notShowFullPath={notShowFullPath}
      />
      {
        !!variableType && (
          <div className="shrink-0 text-text-tertiary system-xs-regular">
            {capitalize(variableType)}
          </div>
        )
      }
      {
        !!errorMsg && (
          <Warning className="h-3 w-3 shrink-0 text-text-warning" />
        )
      }
      {
        rightSlot
      }
    </div>
  )

  if (!errorMsg)
    return badge

  return (
    <Tooltip>
      <TooltipTrigger render={badge} />
      <TooltipContent>{errorMsg}</TooltipContent>
    </Tooltip>
  )
}

export default memo(VariableLabel)
