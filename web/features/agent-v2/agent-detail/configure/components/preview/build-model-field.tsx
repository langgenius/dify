'use client'

import type { AgentSoulModelConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Button } from '@langgenius/dify-ui/button'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { toAgentSoulModelConfig } from '@/features/agent-v2/agent-composer/conversions'
import { consoleQuery } from '@/service/console'
import { isAgentCompatibleModel, isAgentSuggestedModel } from '../../model-compatibility'

type AgentBuildModelFieldProps = {
  agentModel?: AgentSoulModelConfig | null
  buildModel?: AgentSoulModelConfig
  disabled?: boolean
  onBuildModelChange: (buildModel: AgentSoulModelConfig | undefined) => void
}

/**
 * Chooses the model Build chat runs on. Without a choice it shows and follows the
 * Agent model; a choice never changes the model the Agent itself runs on.
 */
export function AgentBuildModelField({
  agentModel,
  buildModel,
  disabled,
  onBuildModelChange,
}: AgentBuildModelFieldProps) {
  const { t } = useTranslation(['agentV2'])
  const currentModel = buildModel ?? agentModel ?? undefined
  const modelListQuery = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data,
    }),
  )
  const providerQuery = useQuery(
    consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions({
      enabled: !!currentModel?.model_provider,
    }),
  )
  const modelStatusUnavailable =
    modelListQuery.data === undefined ||
    (!!currentModel?.model_provider && providerQuery.data === undefined)

  return (
    <Fieldset className="relative z-10 mx-auto grid w-full max-w-150 shrink-0 gap-1 px-3 pt-2 min-[1920px]:max-w-200 min-[2560px]:max-w-240">
      <div className="flex min-w-0 items-center gap-2">
        <FieldsetLegend className="mb-0 shrink-0 py-0 system-xs-medium-uppercase text-text-tertiary">
          {t(($) => $['agentDetail.configure.build.model.label'])}
        </FieldsetLegend>
        <ModelParameterModal
          triggerContainerClassName="min-w-0 flex-1"
          isAdvancedMode
          modelId={currentModel?.model ?? ''}
          provider={currentModel?.model_provider ?? ''}
          completionParams={(currentModel?.model_settings ?? {}) as FormValue}
          hideDebugWithMultipleModel
          modelList={modelListQuery.data ?? []}
          readonly={disabled || modelStatusUnavailable}
          modelListLoading={modelStatusUnavailable}
          showModelMeta={false}
          modelPredicate={isAgentCompatibleModel}
          modelSuggestionPredicate={isAgentSuggestedModel}
          side="bottom"
          align="end"
          setModel={({ modelId, provider, plugin_id }) => {
            onBuildModelChange(toAgentSoulModelConfig({ provider, model: modelId, plugin_id }))
          }}
          onCompletionParamsChange={(modelSettings) => {
            if (!currentModel) return

            onBuildModelChange(
              toAgentSoulModelConfig({
                provider: currentModel.model_provider,
                model: currentModel.model,
                plugin_id: currentModel.plugin_id,
                model_settings: modelSettings,
              }),
            )
          }}
        />
      </div>
      <div className="flex min-h-6 min-w-0 items-center gap-1">
        <p className="min-w-0 flex-1 system-xs-regular text-text-tertiary">
          {buildModel
            ? t(($) => $['agentDetail.configure.build.model.buildOnly'])
            : t(($) => $['agentDetail.configure.build.model.followsAgent'])}
        </p>
        {buildModel && (
          <Button
            size="small"
            variant="ghost-accent"
            className="shrink-0"
            disabled={disabled}
            onClick={() => onBuildModelChange(undefined)}
          >
            {t(($) => $['agentDetail.configure.build.model.useAgentModel'])}
          </Button>
        )}
      </div>
    </Fieldset>
  )
}
