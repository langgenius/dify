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
    <div className='relative flex w-[480px] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9'>
      <div className='absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center' onClick={onClose}>
        <RiCloseLine className='h-4 w-4 text-text-tertiary'/>
      </div>
      {/* Title */}
      <div className='flex flex-col gap-y-[0.5px] px-3 pb-1 pt-3.5'>
        <div className='system-xl-semibold flex pl-1 pr-8 text-text-primary'>
          {t('workflow.nodes.llm.jsonSchema.generateJsonSchema')}
        </div>
        <div className='system-xs-regular flex px-1 text-text-tertiary'>
          {t('workflow.nodes.llm.jsonSchema.generationTip')}
        </div>
      </div>
      {/* Content */}
      <div className='flex flex-col gap-y-1 px-4 py-2'>
        <div className='system-sm-semibold-uppercase flex h-6 items-center text-text-secondary'>
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
        <div className='system-sm-semibold-uppercase flex h-6 items-center text-text-secondary'>
          <span>{t('workflow.nodes.llm.jsonSchema.instruction')}</span>
          <Tooltip popupContent={t('workflow.nodes.llm.jsonSchema.promptTooltip')} />
        </div>
        <div className='flex items-center'>
          <Textarea
            className='h-[364px] resize-none px-2 py-1'
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
          <RiSparklingFill className='h-4 w-4' />
          <span>{t('workflow.nodes.llm.jsonSchema.generate')}</span>
        </Button>
      </div>
    </div>
  )
}

export default React.memo(PromptEditor)
