'use client'

import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { useTranslation } from 'react-i18next'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { isAgentCompatibleModel } from '../../../model-compatibility'
import { useAgentOrchestrateReadOnly } from '../read-only-context'

type AgentModelFieldProps = {
  currentModel?: DefaultModel
  textGenerationModelList: Model[]
  onSelect: (model: DefaultModel) => void
}

export function AgentModelField({
  currentModel,
  textGenerationModelList,
  onSelect,
}: AgentModelFieldProps) {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()

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
              <ModelSelector
                defaultModel={currentModel}
                modelList={textGenerationModelList}
                triggerClassName="h-8! w-full rounded-lg! [&_.i-ri-arrow-down-s-line]:hidden"
                popupClassName="w-(--anchor-width) max-w-[min(var(--anchor-width),var(--available-width),calc(100vw-32px))]"
                providerSettingsSource="agent"
                showModelMeta={false}
                modelPredicate={isAgentCompatibleModel}
                onSelect={onSelect}
              />
            )}
      </div>
    </FieldRoot>
  )
}
