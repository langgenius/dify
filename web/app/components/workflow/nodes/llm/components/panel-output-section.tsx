import type { FC } from 'react'
import type { LLMNodeType, StructuredOutput } from '../types'
import { RiAlertFill, RiQuestionLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import StructureOutput from './structure-output'

type Props = {
  readOnly: boolean
  inputs: LLMNodeType
  isModelSupportStructuredOutput: boolean | undefined
  structuredOutputCollapsed: boolean
  setStructuredOutputCollapsed: (collapsed: boolean) => void
  handleStructureOutputEnableChange: (enabled: boolean) => void
  handleStructureOutputChange: (newOutput: StructuredOutput) => void
}

const i18nPrefix = 'nodes.llm'

const PanelOutputSection: FC<Props> = ({
  readOnly,
  inputs,
  isModelSupportStructuredOutput,
  structuredOutputCollapsed,
  setStructuredOutputCollapsed,
  handleStructureOutputEnableChange,
  handleStructureOutputChange,
}) => {
  const { t } = useTranslation()

  return (
    <>
      <Split />
      <OutputVars
        collapsed={structuredOutputCollapsed}
        onCollapse={setStructuredOutputCollapsed}
        operations={(
          <div className="mr-4 flex shrink-0 items-center">
            {(!isModelSupportStructuredOutput && !!inputs.structured_output_enabled) && (
              <Tooltip>
                <TooltipTrigger
                  delay={0}
                  render={(
                    <div>
                      <RiAlertFill className="mr-1 size-4 text-text-warning-secondary" />
                    </div>
                  )}
                />
                <TooltipContent>
                  <div className="w-[232px] rounded-xl border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-4 py-3.5 shadow-lg backdrop-blur-[5px]">
                    <div className="title-xs-semi-bold text-text-primary">{t('structOutput.modelNotSupported', { ns: 'app' })}</div>
                    <div className="mt-1 body-xs-regular text-text-secondary">{t('structOutput.modelNotSupportedTip', { ns: 'app' })}</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            <div className="mr-0.5 system-xs-medium-uppercase text-text-tertiary">{t('structOutput.structured', { ns: 'app' })}</div>
            <Tooltip>
              <TooltipTrigger
                delay={0}
                render={(
                  <div>
                    <RiQuestionLine className="size-3.5 text-text-quaternary" />
                  </div>
                )}
              />
              <TooltipContent>
                <div className="max-w-[150px]">{t('structOutput.structuredTip', { ns: 'app' })}</div>
              </TooltipContent>
            </Tooltip>
            <Switch
              className="ml-2"
              checked={!!inputs.structured_output_enabled}
              onCheckedChange={handleStructureOutputEnableChange}
              size="md"
              disabled={readOnly}
            />
          </div>
        )}
      >
        <>
          <VarItem
            name="text"
            type="string"
            description={t(`${i18nPrefix}.outputVars.output`, { ns: 'workflow' })}
          />
          <VarItem
            name="reasoning_content"
            type="string"
            description={t(`${i18nPrefix}.outputVars.reasoning_content`, { ns: 'workflow' })}
          />
          <VarItem
            name="usage"
            type="object"
            description={t(`${i18nPrefix}.outputVars.usage`, { ns: 'workflow' })}
          />
          {inputs.structured_output_enabled && (
            <>
              <Split className="mt-3" />
              <StructureOutput
                className="mt-4"
                value={inputs.structured_output}
                onChange={handleStructureOutputChange}
              />
            </>
          )}
        </>
      </OutputVars>
    </>
  )
}

export default React.memo(PanelOutputSection)
