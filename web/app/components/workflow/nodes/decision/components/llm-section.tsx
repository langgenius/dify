import type { FC } from 'react'
import type { DecisionNodeType } from '../types'
import type { DecisionConfig } from '../use-config'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { FieldCollapse } from '@/app/components/workflow/nodes/_base/components/collapse'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'

const i18nPrefix = 'nodes.decision'

type LlmSectionProps = {
  nodeId: string
  inputs: DecisionNodeType
  config: DecisionConfig
}

const LlmSection: FC<LlmSectionProps> = ({ nodeId, inputs, config }) => {
  const { t } = useTranslation(['workflow'])
  const {
    readOnly,
    filterVar,
    handleModelChanged,
    handleCompletionParamsChange,
    handleInputsChange,
    handleGlossaryChange,
    handlePromptChange,
    nodesOutputVars,
    availableNodes,
  } = config
  const model = inputs.model

  return (
    <>
      <Field
        title={t(($) => $[`${i18nPrefix}.model`], { ns: 'workflow' })}
        className="px-4 py-2"
        required
      >
        <ModelParameterModal
          popupClassName="w-[387px]!"
          isInWorkflow
          isAdvancedMode={true}
          provider={model?.provider ?? ''}
          completionParams={model?.completion_params ?? {}}
          modelId={model?.name ?? ''}
          setModel={handleModelChanged}
          onCompletionParamsChange={handleCompletionParamsChange}
          hideDebugWithMultipleModel
          debugWithMultipleModel={false}
          readonly={readOnly}
          nodesOutputVars={nodesOutputVars}
          availableNodes={availableNodes}
        />
      </Field>
      <Field
        title={t(($) => $[`${i18nPrefix}.inputs`], { ns: 'workflow' })}
        className="px-4 py-2"
        required
      >
        <VarList
          readonly={readOnly}
          nodeId={nodeId}
          list={inputs.inputs}
          onChange={handleInputsChange}
          filterVar={filterVar}
          isSupportFileVar={false}
        />
      </Field>
      <Field
        title={t(($) => $[`${i18nPrefix}.glossary`], { ns: 'workflow' })}
        className="px-4 py-2"
      >
        <>
          <textarea
            className="h-20 w-full resize-none rounded-lg border border-divider-regular bg-components-input-bg-normal px-2 py-1.5 text-xs leading-5 font-normal text-text-secondary outline-none focus:border-components-input-border-active"
            value={inputs.context.glossary}
            readOnly={readOnly}
            aria-label={t(($) => $[`${i18nPrefix}.glossary`], { ns: 'workflow' })}
            onChange={(e) => handleGlossaryChange(e.target.value)}
            placeholder={t(($) => $[`${i18nPrefix}.glossaryPlaceholder`], { ns: 'workflow' })}
          />
          <div className="text-xs leading-4 font-normal text-text-tertiary">
            {t(($) => $[`${i18nPrefix}.glossaryHelper`], { ns: 'workflow' })}
          </div>
        </>
      </Field>
      <FieldCollapse
        title={t(($) => $[`${i18nPrefix}.customInstruction`], { ns: 'workflow' })}
        actions={
          !readOnly && !!inputs.context.prompt ? (
            <Button size="small" variant="ghost" onClick={() => handlePromptChange('')}>
              {t(($) => $[`${i18nPrefix}.restoreBuiltIn`], { ns: 'workflow' })}
            </Button>
          ) : undefined
        }
      >
        <>
          <textarea
            className="h-24 w-full resize-none rounded-lg border border-divider-regular bg-components-input-bg-normal px-2 py-1.5 text-xs leading-5 font-normal text-text-secondary outline-none focus:border-components-input-border-active"
            value={inputs.context.prompt}
            readOnly={readOnly}
            aria-label={t(($) => $[`${i18nPrefix}.customInstruction`], { ns: 'workflow' })}
            onChange={(e) => handlePromptChange(e.target.value)}
            placeholder={t(($) => $[`${i18nPrefix}.customInstructionPlaceholder`], {
              ns: 'workflow',
            })}
          />
          <div className="text-xs leading-4 font-normal text-text-tertiary">
            {t(($) => $[`${i18nPrefix}.customInstructionHelper`], { ns: 'workflow' })}
          </div>
        </>
      </FieldCollapse>
    </>
  )
}

export default LlmSection
