'use client'
import type { FC } from 'react'
import type { ToolSetting } from '../types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import FieldCollapse from '@/app/components/workflow/nodes/_base/components/collapse/field-collapse'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ReferenceToolConfig from './reference-tool-config'

const i18nPrefix = 'nodes.llm.computerUse'

type Props = {
  readonly: boolean
  isDisabledByStructuredOutput: boolean
  disabledTip?: string
  enabled: boolean
  onChange: (enabled: boolean) => void
  nodeId: string
  toolSettings?: ToolSetting[]
  promptTemplateKey: string
}

const ComputerUseConfig: FC<Props> = ({
  readonly,
  isDisabledByStructuredOutput,
  disabledTip,
  enabled,
  onChange,
  nodeId,
  toolSettings,
  promptTemplateKey,
}) => {
  const { t } = useTranslation()
  const isDisabled = readonly || isDisabledByStructuredOutput

  return (
    <div>
      <Split />
      <FieldCollapse
        title={(
          <div className="flex items-center gap-1">
            {t(`${i18nPrefix}.title`, { ns: 'workflow' })}
            <Tooltip>
              <TooltipTrigger
                delay={0}
                className="flex h-4 w-4 items-center justify-center"
              >
                <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary" />
              </TooltipTrigger>
              <TooltipContent>{t(`${i18nPrefix}.tooltip`, { ns: 'workflow' })}</TooltipContent>
            </Tooltip>
          </div>
        )}
        noXSpacing
        operations={(
          <div>
            <Tooltip>
              <TooltipTrigger
                disabled={!disabledTip}
                render={(
                  <div>
                    <Switch
                      size="md"
                      disabled={isDisabled}
                      value={enabled}
                      onChange={onChange}
                    />
                  </div>
                )}
              />
              {disabledTip && (
                <TooltipContent>{disabledTip}</TooltipContent>
              )}
            </Tooltip>
          </div>
        )}
      >
        <div className="mt-1 flex flex-col gap-1 p-1">
          <div className="flex h-6 items-center gap-1">
            <div className="text-text-tertiary system-xs-medium">
              {t(`${i18nPrefix}.referenceTools`, { ns: 'workflow' })}
            </div>
          </div>
          <ReferenceToolConfig
            readonly={readonly}
            isDisabledByStructuredOutput={isDisabledByStructuredOutput}
            isComputerUseEnabled={enabled}
            nodeId={nodeId}
            toolSettings={toolSettings}
            promptTemplateKey={promptTemplateKey}
          />
        </div>
      </FieldCollapse>
      <Split />
    </div>
  )
}

export default React.memo(ComputerUseConfig)
