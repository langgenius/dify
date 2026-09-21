import type { FC } from 'react'
import type { LLMNodeType, StructuredOutput } from '../types'
import { Switch } from '@langgenius/dify-ui/switch'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { StructureOutput } from './structure-output'

type Props = Readonly<{
  readOnly: boolean
  inputs: LLMNodeType
  isModelSupportStructuredOutput: boolean | undefined
  structuredOutputCollapsed: boolean
  setStructuredOutputCollapsed: (collapsed: boolean) => void
  handleStructureOutputEnableChange: (enabled: boolean) => void
  handleStructureOutputChange: (newOutput: StructuredOutput) => void
}>

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
        operations={
          <div className="mr-4 flex shrink-0 items-center">
            {!isModelSupportStructuredOutput && !!inputs.structured_output_enabled && (
              <Infotip
                aria-label={t(($) => $['structOutput.modelNotSupported'], { ns: 'app' })}
                iconVariant="warning"
                iconSize="large"
                className="mr-1 text-text-warning-secondary"
                popupClassName="w-58"
              >
                <div className="title-xs-semi-bold text-text-primary">
                  {t(($) => $['structOutput.modelNotSupported'], { ns: 'app' })}
                </div>
                <div className="mt-1">
                  {t(($) => $['structOutput.modelNotSupportedTip'], { ns: 'app' })}
                </div>
              </Infotip>
            )}
            <div className="mr-0.5 system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $['structOutput.structured'], { ns: 'app' })}
            </div>
            <Infotip
              aria-label={t(($) => $['structOutput.structuredTip'], { ns: 'app' })}
              popupClassName="w-[150px]"
            >
              {t(($) => $['structOutput.structuredTip'], { ns: 'app' })}
            </Infotip>
            <Switch
              className="ml-2"
              checked={!!inputs.structured_output_enabled}
              onCheckedChange={handleStructureOutputEnableChange}
              size="md"
              disabled={readOnly}
            />
          </div>
        }
      >
        <>
          <VarItem
            name="text"
            type="string"
            description={t(($) => $[`${i18nPrefix}.outputVars.output`], { ns: 'workflow' })}
          />
          <VarItem
            name="reasoning_content"
            type="string"
            description={t(($) => $[`${i18nPrefix}.outputVars.reasoning_content`], {
              ns: 'workflow',
            })}
          />
          <VarItem
            name="usage"
            type="object"
            description={t(($) => $[`${i18nPrefix}.outputVars.usage`], { ns: 'workflow' })}
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
