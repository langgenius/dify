import type { VariablePayload } from '../types'
import {
  RiErrorWarningFill,
  RiMoreLine,
} from '@remixicon/react'
import { capitalize } from 'es-toolkit/string'
import { memo } from 'react'
import Tooltip from '@/app/components/base/tooltip'
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
  const isHideNodeLabel = !(isENV(variables) || isConversationVar(variables) || isGlobalVar(variables) || isRagVariableVar(variables))
  return (
    <div
      className={cn(
        'inline-flex h-6 max-w-full items-center space-x-0.5 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark px-1.5 shadow-xs',
        className,
      )}
      onClick={onClick}
      ref={ref}
    >
      { isHideNodeLabel && (
        <VariableNodeLabel
          nodeType={nodeType}
          nodeTitle={nodeTitle}
        />
      )}
      {
        notShowFullPath && (
          <>
            <RiMoreLine className="h-3 w-3 shrink-0 text-text-secondary" />
            <div className="system-xs-regular shrink-0 text-divider-deep">/</div>
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
          <div className="system-xs-regular shrink-0 text-text-tertiary">
            {capitalize(variableType)}
          </div>
        )
      }
      {
        !!errorMsg && (
          <Tooltip
            popupContent={errorMsg}
            asChild
          >
            <RiErrorWarningFill className="h-3 w-3 shrink-0 text-text-destructive" />
          </Tooltip>
        )
      }
      {
        rightSlot
      }
    </div>
  )
}

export default memo(VariableLabel)
