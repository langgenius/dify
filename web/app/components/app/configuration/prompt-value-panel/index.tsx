'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiPlayLargeFill,
} from '@remixicon/react'
import ConfigContext from '@/context/debug-configuration'
import type { Inputs } from '@/models/debug'
import { AppType, ModelModeType } from '@/types/app'
import Select from '@/app/components/base/select'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Tooltip from '@/app/components/base/tooltip'
import TextGenerationImageUploader from '@/app/components/base/image-uploader/text-generation-image-uploader'
import FeatureBar from '@/app/components/base/features/new-feature-panel/feature-bar'
import type { VisionFile, VisionSettings } from '@/types/app'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import { useStore as useAppStore } from '@/app/components/app/store'
import cn from '@/utils/classnames'

export type IPromptValuePanelProps = {
  appType: AppType
  onSend?: () => void
  inputs: Inputs
  visionConfig: VisionSettings
  onVisionFilesChange: (files: VisionFile[]) => void
}

const PromptValuePanel: FC<IPromptValuePanelProps> = ({
  appType,
  onSend,
  inputs,
  visionConfig,
  onVisionFilesChange,
}) => {
  const { t } = useTranslation()
  const { modelModeType, modelConfig, setInputs, mode, isAdvancedMode, completionPromptConfig, chatPromptConfig } = useContext(ConfigContext)
  const [userInputFieldCollapse, setUserInputFieldCollapse] = useState(false)
  const promptVariables = modelConfig.configs.prompt_variables.filter(({ key, name }) => {
    return key && key?.trim() && name && name?.trim()
  })

  const promptVariableObj = useMemo(() => {
    const obj: Record<string, boolean> = {}
    promptVariables.forEach((input) => {
      obj[input.key] = true
    })
    return obj
  }, [promptVariables])

  const canNotRun = useMemo(() => {
    if (mode !== AppType.completion)
      return true

    if (isAdvancedMode) {
      if (modelModeType === ModelModeType.chat)
        return chatPromptConfig.prompt.every(({ text }) => !text)
      return !completionPromptConfig.prompt?.text
    }

    else { return !modelConfig.configs.prompt_template }
  }, [chatPromptConfig.prompt, completionPromptConfig.prompt?.text, isAdvancedMode, mode, modelConfig.configs.prompt_template, modelModeType])

  const handleInputValueChange = (key: string, value: string) => {
    if (!(key in promptVariableObj))
      return

    const newInputs = { ...inputs }
    promptVariables.forEach((input) => {
      if (input.key === key)
        newInputs[key] = value
    })
    setInputs(newInputs)
  }

  const onClear = () => {
    const newInputs: Record<string, any> = {}
    promptVariables.forEach((item) => {
      newInputs[item.key] = ''
    })
    setInputs(newInputs)
  }

  const setShowAppConfigureFeaturesModal = useAppStore(s => s.setShowAppConfigureFeaturesModal)

  return (
    <>
      <div className='relative z-[1] mx-3 border-[0.5px] bg-components-panel-on-panel-item-bg border-components-panel-border-subtle rounded-xl shadow-md'>
        <div className={cn('px-4 pt-3', userInputFieldCollapse ? 'pb-3' : 'pb-1')}>
          <div className='flex items-center gap-0.5 py-0.5 cursor-pointer' onClick={() => setUserInputFieldCollapse(!userInputFieldCollapse)}>
            <div className='text-text-secondary system-md-semibold-uppercase'>{t('appDebug.inputs.userInputField')}</div>
            {userInputFieldCollapse && <RiArrowRightSLine className='w-4 h-4 text-text-secondary'/>}
            {!userInputFieldCollapse && <RiArrowDownSLine className='w-4 h-4 text-text-secondary'/>}
          </div>
          {!userInputFieldCollapse && (
            <div className='mt-1 text-text-tertiary system-xs-regular'>{t('appDebug.inputs.completionVarTip')}</div>
          )}
        </div>
        {!userInputFieldCollapse && promptVariables.length > 0 && (
          <div className='px-4 pt-3 pb-4'>
            {promptVariables.map(({ key, name, type, options, max_length, required }, index) => (
              <div
                key={key}
                className='mb-4 last-of-type:mb-0'
              >
                <div>
                  <div className='h-6 mb-1 flex items-center gap-1 text-text-secondary system-sm-semibold'>
                    <div className='truncate'>{name || key}</div>
                    {!required && <span className='text-text-tertiary system-xs-regular'>{t('workflow.panel.optional')}</span>}
                  </div>
                  <div className='grow'>
                    {type === 'string' && (
                      <Input
                        value={inputs[key] ? `${inputs[key]}` : ''}
                        onChange={(e) => { handleInputValueChange(key, e.target.value) }}
                        placeholder={name}
                        autoFocus={index === 0}
                        maxLength={max_length || DEFAULT_VALUE_MAX_LEN}
                      />
                    )}
                    {type === 'paragraph' && (
                      <Textarea
                        className='grow h-[120px]'
                        placeholder={name}
                        value={inputs[key] ? `${inputs[key]}` : ''}
                        onChange={(e) => { handleInputValueChange(key, e.target.value) }}
                      />
                    )}
                    {type === 'select' && (
                      <Select
                        className='w-full'
                        defaultValue={inputs[key] as string}
                        onSelect={(i) => { handleInputValueChange(key, i.value as string) }}
                        items={(options || []).map(i => ({ name: i, value: i }))}
                        allowSearch={false}
                        bgClassName='bg-gray-50'
                      />
                    )}
                    {type === 'number' && (
                      <Input
                        type='number'
                        value={inputs[key] ? `${inputs[key]}` : ''}
                        onChange={(e) => { handleInputValueChange(key, e.target.value) }}
                        placeholder={name}
                        autoFocus={index === 0}
                        maxLength={max_length || DEFAULT_VALUE_MAX_LEN}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
            {visionConfig?.enabled && (
              <div className="mt-3 xl:flex justify-between">
                <div className="mr-1 py-2 shrink-0 w-[120px] text-sm text-gray-900">{t('common.imageUploader.imageUpload')}</div>
                <div className='grow'>
                  <TextGenerationImageUploader
                    settings={visionConfig}
                    onFilesChange={files => onVisionFilesChange(files.filter(file => file.progress !== -1).map(fileItem => ({
                      type: 'image',
                      transfer_method: fileItem.type,
                      url: fileItem.url,
                      upload_file_id: fileItem.fileId,
                    })))}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        {!userInputFieldCollapse && (
          <div className='flex justify-between p-4 pt-3 border-t border-divider-subtle'>
            <Button className='w-[72px]' onClick={onClear}>{t('common.operation.clear')}</Button>
            {canNotRun && (
              <Tooltip popupContent={t('appDebug.otherError.promptNoBeEmpty')} needsDelay>
                <Button
                  variant="primary"
                  disabled={canNotRun}
                  onClick={() => onSend && onSend()}
                  className="w-[96px]">
                  <RiPlayLargeFill className="shrink-0 w-4 h-4 mr-0.5" aria-hidden="true" />
                  {t('appDebug.inputs.run')}
                </Button>
              </Tooltip>
            )}
            {!canNotRun && (
              <Button
                variant="primary"
                disabled={canNotRun}
                onClick={() => onSend && onSend()}
                className="w-[96px]">
                <RiPlayLargeFill className="shrink-0 w-4 h-4 mr-0.5" aria-hidden="true" />
                {t('appDebug.inputs.run')}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className='mx-3'>
        <FeatureBar
          showFileUpload={false}
          isChatMode={appType !== AppType.completion}
          onFeatureBarClick={setShowAppConfigureFeaturesModal} />
      </div>
    </>
  )
}

export default React.memo(PromptValuePanel)
