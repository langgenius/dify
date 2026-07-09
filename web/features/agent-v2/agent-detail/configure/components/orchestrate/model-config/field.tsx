'use client'

import type { FormValue, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { AgentComposerModel } from '@/features/agent-v2/agent-composer/form-state'
import { FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { isAgentCompatibleModel, isAgentSuggestedModel } from '../../../model-compatibility'
import { useAgentOrchestrateReadOnly } from '../read-only-context'

type AgentModelFieldProps = {
  currentModel?: AgentComposerModel
  textGenerationModelList: Model[]
  onSelect: (model: AgentComposerModel) => void
}

export function AgentModelField({
  currentModel,
  textGenerationModelList,
  onSelect,
}: AgentModelFieldProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const readOnly = useAgentOrchestrateReadOnly()
  const canConfigureModelSettings = !readOnly && !!currentModel?.provider && !!currentModel.model

  return (
    <FieldRoot name="model" className="gap-1 pb-4">
      <FieldLabel className="py-0 system-sm-semibold-uppercase! text-text-secondary">
        {t('agentDetail.configure.model.label')}
      </FieldLabel>
      <div className="relative h-8 min-w-0">
        {readOnly
          ? (
              <div className="flex h-8 w-full min-w-0 items-center rounded-lg bg-components-input-bg-disabled px-3 system-sm-regular text-components-input-text-filled">
                <span className="truncate">{currentModel?.model}</span>
              </div>
            )
          : (
              <div className="flex h-8 min-w-0 items-center gap-px overflow-hidden rounded-lg">
                <ModelSelector
                  defaultModel={currentModel}
                  modelList={textGenerationModelList}
                  triggerClassName="h-8! w-full rounded-r-none! [&_.i-ri-arrow-down-s-line]:hidden"
                  popupClassName="w-(--anchor-width) max-w-[min(var(--anchor-width),var(--available-width),calc(100vw-32px))]"
                  providerSettingsSource="agent"
                  showModelMeta={false}
                  modelPredicate={isAgentCompatibleModel}
                  modelSuggestionPredicate={isAgentSuggestedModel}
                  onSelect={onSelect}
                />
                <div className="w-8 shrink-0">
                  <ModelParameterModal
                    isAdvancedMode
                    modelId={currentModel?.model ?? ''}
                    provider={currentModel?.provider ?? ''}
                    completionParams={(currentModel?.model_settings ?? {}) as FormValue}
                    readonly={!canConfigureModelSettings}
                    hideDebugWithMultipleModel
                    popupClassName="w-[400px]"
                    setModel={({ modelId, provider }) => {
                      onSelect({
                        ...currentModel,
                        provider,
                        model: modelId,
                      })
                    }}
                    onCompletionParamsChange={(modelSettings) => {
                      if (!currentModel)
                        return

                      onSelect({
                        ...currentModel,
                        model_settings: modelSettings,
                      })
                    }}
                    renderTrigger={() => (
                      <Tooltip>
                        <TooltipTrigger
                          disabled={!canConfigureModelSettings}
                          render={(
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-l-none rounded-r-lg bg-components-button-tertiary-bg text-text-tertiary hover:bg-components-button-tertiary-bg-hover hover:text-text-secondary aria-disabled:cursor-not-allowed aria-disabled:text-text-disabled">
                              <span className="sr-only">{tCommon('modelProvider.modelSettings')}</span>
                              <span className="i-ri-equalizer-2-line size-4" />
                            </span>
                          )}
                        />
                        <TooltipContent placement="top">
                          {tCommon('modelProvider.modelSettings')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  />
                </div>
              </div>
            )}
      </div>
    </FieldRoot>
  )
}
