import type { FC } from 'react'
import type { LLMNodeType, StructuredOutput } from '../types'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Switch } from '@langgenius/dify-ui/switch'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
              <Popover>
                <PopoverTrigger
                  openOnHover
                  nativeButton={false}
                  aria-label={t('structOutput.modelNotSupported', { ns: 'app' })}
                  render={(
                    <div className="mr-1">
                      <span aria-hidden className="i-ri-alert-fill block size-4 text-text-warning-secondary" />
                    </div>
                  )}
                />
                <PopoverContent popupClassName="max-w-[300px] rounded-md border-0 bg-components-panel-bg px-3 py-2 system-xs-regular text-text-tertiary shadow-lg">
                  <div className="w-[232px] rounded-xl border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-4 py-3.5 shadow-lg backdrop-blur-[5px]">
                    <div className="title-xs-semi-bold text-text-primary">{t('structOutput.modelNotSupported', { ns: 'app' })}</div>
                    <div className="mt-1 body-xs-regular text-text-secondary">{t('structOutput.modelNotSupportedTip', { ns: 'app' })}</div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <div className="mr-0.5 system-xs-medium-uppercase text-text-tertiary">{t('structOutput.structured', { ns: 'app' })}</div>
            <Popover>
              <PopoverTrigger
                openOnHover
                nativeButton={false}
                aria-label={t('structOutput.structuredTip', { ns: 'app' })}
                render={(
                  <div>
                    <span aria-hidden className="i-ri-question-line block size-3.5 text-text-quaternary" />
                  </div>
                )}
              />
              <PopoverContent popupClassName="max-w-[300px] rounded-md border-0 bg-components-panel-bg px-3 py-2 system-xs-regular text-text-tertiary shadow-lg">
                <div className="max-w-[150px]">{t('structOutput.structuredTip', { ns: 'app' })}</div>
              </PopoverContent>
            </Popover>
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
