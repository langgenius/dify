'use client'

import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { AgentComposerModel } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { consoleQuery } from '@/service/console'
import { isAgentCompatibleModel, isAgentSuggestedModel } from '../../../model-compatibility'
import { useAgentOrchestrateReadOnly } from '../read-only-context'

type AgentModelFieldProps = {
  currentModel?: AgentComposerModel
  onSelect: (model: AgentComposerModel) => void
}

export function AgentModelField({ currentModel, onSelect }: AgentModelFieldProps) {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const modelListQuery = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data,
      enabled: !readOnly,
    }),
  )
  const providerQuery = useQuery(
    consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions({
      enabled: !readOnly && !!currentModel?.provider,
    }),
  )
  const modelListUnavailable = modelListQuery.data === undefined
  const providerUnavailable = !!currentModel?.provider && providerQuery.data === undefined
  const modelStatusUnavailable = modelListUnavailable || providerUnavailable
  const hasLoadError =
    (modelListUnavailable && modelListQuery.isError) ||
    (providerUnavailable && providerQuery.isError)

  return (
    <Field name="model" className="gap-0 pb-4">
      <FieldLabel className="system-sm-semibold-uppercase! text-text-secondary">
        {t(($) => $['agentDetail.configure.model.label'])}
      </FieldLabel>
      {readOnly ? (
        <div className="flex h-8 w-full min-w-0 items-center rounded-lg bg-components-input-bg-disabled px-3 system-sm-regular text-components-input-text-filled">
          <span className="truncate">{currentModel?.model}</span>
        </div>
      ) : (
        <ModelParameterModal
          isAdvancedMode
          modelId={currentModel?.model ?? ''}
          provider={currentModel?.provider ?? ''}
          completionParams={(currentModel?.model_settings ?? {}) as FormValue}
          hideDebugWithMultipleModel
          modelList={modelListQuery.data ?? []}
          readonly={modelStatusUnavailable}
          modelListLoading={modelStatusUnavailable}
          showModelMeta={false}
          modelPredicate={isAgentCompatibleModel}
          modelSuggestionPredicate={isAgentSuggestedModel}
          placement="bottom-end"
          setModel={({ modelId, provider, plugin_id }) => {
            onSelect({
              provider,
              model: modelId,
              plugin_id,
            })
          }}
          onCompletionParamsChange={(modelSettings) => {
            if (!currentModel) return

            onSelect({
              ...currentModel,
              model_settings: modelSettings,
            })
          }}
        />
      )}
      {!readOnly && hasLoadError && (
        <div role="alert" className="flex items-center gap-2 text-text-warning">
          <span>{t(($) => $['api.actionFailed'], { ns: 'common' })}</span>
          <Button
            size="small"
            onClick={() => {
              if (modelListUnavailable) void modelListQuery.refetch()
              if (providerUnavailable) void providerQuery.refetch()
            }}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
    </Field>
  )
}
