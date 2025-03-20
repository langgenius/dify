import React, { useCallback } from 'react'
import type { FC } from 'react'
import { RiCloseLine, RiSparklingFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Textarea from '@/app/components/base/textarea'
import Tooltip from '@/app/components/base/tooltip'
import Button from '@/app/components/base/button'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import type { Model } from '@/types/app'

export type ModelInfo = {
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
    <div className='flex flex-col relative w-[480px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9'>
      <div className='flex items-center justify-center absolute top-2.5 right-2.5 w-8 h-8' onClick={onClose}>
        <RiCloseLine className='w-4 h-4 text-text-tertiary'/>
      </div>
      {/* Title */}
      <div className='flex flex-col gap-y-[0.5px] px-3 pt-3.5 pb-1'>
        <div className='flex pl-1 pr-8 text-text-primary system-xl-semibold'>
          {t('workflow.nodes.llm.jsonSchema.generateJsonSchema')}
        </div>
        <div className='flex px-1 text-text-tertiary system-xs-regular'>
          {t('workflow.nodes.llm.jsonSchema.generationTip')}
        </div>
      </div>
      {/* Content */}
      <div className='flex flex-col gap-y-1 px-4 py-2'>
        <div className='flex items-center h-6 text-text-secondary system-sm-semibold-uppercase'>
          {t('common.modelProvider.model')}
        </div>
        <ModelParameterModal
          popupClassName='!w-[448px]'
          portalToFollowElemContentClassName='z-[1000]'
          isAdvancedMode={true}
          provider={model.provider}
          mode={model.mode}
          completionParams={model.completion_params}
          modelId={model.name}
          setModel={onModelChange}
          onCompletionParamsChange={onCompletionParamsChange}
          hideDebugWithMultipleModel
        />
      </div>
      <div className='flex flex-col gap-y-1 px-4 py-2'>
        <div className='flex items-center h-6 text-text-secondary system-sm-semibold-uppercase'>
          <span>{t('workflow.nodes.llm.jsonSchema.instruction')}</span>
          <Tooltip popupContent={t('workflow.nodes.llm.jsonSchema.promptTooltip')} />
        </div>
        <div className='flex items-center'>
          <Textarea
            className='h-[364px] px-2 py-1 resize-none'
            value={instruction}
            placeholder={t('workflow.nodes.llm.jsonSchema.promptPlaceholder')}
            onChange={handleInstructionChange}
          />
        </div>
      </div>
      {/* Footer */}
      <div className='flex justify-end gap-x-2 p-4 pt-2'>
        <Button variant='secondary' onClick={onClose}>
          {t('common.operation.cancel')}
        </Button>
        <Button
          variant='primary'
          className='flex items-center gap-x-0.5'
          onClick={onGenerate}
        >
          <RiSparklingFill className='w-4 h-4' />
          <span>{t('workflow.nodes.llm.jsonSchema.generate')}</span>
        </Button>
      </div>
    </div>
  )
}

export default React.memo(PromptEditor)
