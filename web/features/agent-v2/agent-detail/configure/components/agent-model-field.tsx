'use client'

import type { DefaultModel, Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { useTranslation } from 'react-i18next'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'

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

  return (
    <FieldRoot name="model" className="gap-1 pb-4">
      <FieldLabel className="py-0 system-sm-semibold-uppercase! text-text-secondary">
        {t('agentDetail.configure.model.label')}
      </FieldLabel>
      <div className="relative h-8 min-w-0">
        <ModelSelector
          defaultModel={currentModel}
          modelList={textGenerationModelList}
          triggerClassName="h-8! w-full rounded-lg! pr-10! [&_.i-ri-arrow-down-s-line]:hidden"
          popupClassName="w-(--anchor-width) max-w-[min(var(--anchor-width),var(--available-width),calc(100vw-32px))]"
          showModelMeta={false}
          onSelect={onSelect}
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-lg bg-components-button-tertiary-bg">
          <span aria-hidden="true" className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
        </div>
      </div>
    </FieldRoot>
  )
}
