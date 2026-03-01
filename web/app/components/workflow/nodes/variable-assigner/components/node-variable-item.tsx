import type { Node, ValueSelector } from '@/app/components/workflow/types'
import type { I18nKeysByPrefix } from '@/types/i18n'
import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import { InputField } from '@/app/components/base/icons/src/vender/pipeline'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { isConversationVar, isENV, isRagVariableVar, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { cn } from '@/utils/classnames'

type NodeVariableItemProps = {
  node: Node
  variable: ValueSelector
  writeMode?: I18nKeysByPrefix<'workflow', 'nodes.assigner.operations.'>
  showBorder?: boolean
  className?: string
  isException?: boolean
}

const i18nPrefix = 'nodes.assigner'

const NodeVariableItem = ({
  node,
  variable,
  writeMode,
  showBorder,
  className,
  isException,
}: NodeVariableItemProps) => {
  const { t } = useTranslation()

  const isSystem = isSystemVar(variable)
  const isEnv = isENV(variable)
  const isChatVar = isConversationVar(variable)
  const isRagVar = isRagVariableVar(variable)
  const varName = useMemo(() => {
    if (isSystem)
      return `sys.${variable[variable.length - 1]}`
    if (isRagVar)
      return variable[variable.length - 1]
    return variable.slice(1).join('.')
  }, [isRagVar, isSystem, variable])

  const VariableIcon = useMemo(() => {
    if (isEnv) {
      return (
        <Env className="h-3.5 w-3.5 shrink-0 text-util-colors-violet-violet-600" />
      )
    }

    if (isChatVar) {
      return (
        <BubbleX className="h-3.5 w-3.5 shrink-0 text-util-colors-teal-teal-700" />
      )
    }

    if (isRagVar) {
      return (
        <InputField className="h-3.5 w-3.5 shrink-0 text-text-accent" />
      )
    }

    return (
      <Variable02
        className={cn(
          'h-3.5 w-3.5 shrink-0 text-text-accent',
          isException && 'text-text-warning',
        )}
      />
    )
  }, [isEnv, isChatVar, isRagVar, isException])

  const VariableName = useMemo(() => {
    return (
      <div
        className={cn(
          'system-xs-medium ml-0.5 shrink truncate text-text-accent',
          isEnv && 'text-text-primary',
          isException && 'text-text-warning',
          isChatVar && 'text-util-colors-teal-teal-700',
        )}
        title={varName}
      >
        {varName}
      </div>
    )
  }, [isEnv, isChatVar, varName, isException])
  return (
    <div className={cn(
      'relative flex items-center gap-1 self-stretch rounded-md bg-workflow-block-parma-bg p-[3px] pl-[5px]',
      showBorder && '!bg-state-base-hover',
      className,
    )}
    >
      <div className="flex w-0 grow items-center">
        {
          node && (
            <>
              <div className="shrink-0 p-[1px]">
                <VarBlockIcon
                  className="!text-text-primary"
                  type={node.data.type}
                />
              </div>
              <div
                className="mx-0.5 shrink-[1000] truncate text-xs font-medium text-text-secondary"
                title={node?.data.title}
              >
                {node?.data.title}
              </div>
              <Line3 className="mr-0.5 shrink-0"></Line3>
            </>
          )
        }
        {VariableIcon}
        {VariableName}
      </div>
      {writeMode && <Badge className="shrink-0" text={t(`${i18nPrefix}.operations.${writeMode}`, { ns: 'workflow' }) as string} />}
    </div>
  )
}

export default memo(NodeVariableItem)
