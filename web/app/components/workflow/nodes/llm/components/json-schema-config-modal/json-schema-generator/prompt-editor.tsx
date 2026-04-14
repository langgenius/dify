import type { FC } from 'react'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Model } from '@/types/app'
import { RiCloseLine, RiSparklingFill } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from '@/app/components/base/textarea'
import Tooltip from '@/app/components/base/tooltip'
import { Button } from '@/app/components/base/ui/button'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'

type ModelInfo = {
  modelId: string
  provider: string
  mode?: string
  features?: string[]
}

type PromptEditorProps = {
  instruction: string
  model: Model
  onInstructionChange: (instruction: string) => void
  onCompletionParamsChange: (newParams: FormValue) => void
  onModelChange: (model: ModelInfo) => void
  onClose: () => void
  onGenerate: () => void
}

const PromptEditor: FC<PromptEditorProps> = ({
  instruction,
  model,
  onInstructionChange,
  onCompletionParamsChange,
  onClose,
  onGenerate,
  onModelChange,
}) => {
  const { t } = useTranslation()

  const handleInstructionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onInstructionChange(e.target.value)
  }, [onInstructionChange])

  return (
    <div className="relative flex w-[480px] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9">
      <div className="absolute top-2.5 right-2.5 flex h-8 w-8 items-center justify-center" onClick={onClose}>
        <RiCloseLine className="h-4 w-4 text-text-tertiary" />
      </div>
      {/* Title */}
      <div className="flex flex-col gap-y-[0.5px] px-3 pt-3.5 pb-1">
        <div className="flex pr-8 pl-1 system-xl-semibold text-text-primary">
          {t('nodes.llm.jsonSchema.generateJsonSchema', { ns: 'workflow' })}
        </div>
        <div className="flex px-1 system-xs-regular text-text-tertiary">
          {t('nodes.llm.jsonSchema.generationTip', { ns: 'workflow' })}
        </div>
      </div>
      {/* Content */}
      <div className="flex flex-col gap-y-1 px-4 py-2">
        <div className="flex h-6 items-center system-sm-semibold-uppercase text-text-secondary">
          {t('modelProvider.model', { ns: 'common' })}
        </div>
        <ModelParameterModal
          popupClassName="w-[448px]!"
          isAdvancedMode={true}
          provider={model.provider}
          completionParams={model.completion_params}
          modelId={model.name}
          setModel={onModelChange}
          onCompletionParamsChange={onCompletionParamsChange}
          hideDebugWithMultipleModel
        />
      </div>
      <div className="flex flex-col gap-y-1 px-4 py-2">
        <div className="flex h-6 items-center system-sm-semibold-uppercase text-text-secondary">
          <span>{t('nodes.llm.jsonSchema.instruction', { ns: 'workflow' })}</span>
          <Tooltip popupContent={t('nodes.llm.jsonSchema.promptTooltip', { ns: 'workflow' })} />
        </div>
        <div className="flex items-center">
          <Textarea
            className="h-[364px] resize-none px-2 py-1"
            value={instruction}
            placeholder={t('nodes.llm.jsonSchema.promptPlaceholder', { ns: 'workflow' })}
            onChange={handleInstructionChange}
          />
        </div>
      </div>
      {/* Footer */}
      <div className="flex justify-end gap-x-2 p-4 pt-2">
        <Button variant="secondary" onClick={onClose}>
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button
          variant="primary"
          className="flex items-center gap-x-0.5"
          onClick={onGenerate}
        >
          <RiSparklingFill className="h-4 w-4" />
          <span>{t('nodes.llm.jsonSchema.generate', { ns: 'workflow' })}</span>
        </Button>
      </div>
    </div>
  )
}

export default React.memo(PromptEditor)
