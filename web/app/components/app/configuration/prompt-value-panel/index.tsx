'use client'
import type { FC } from 'react'
import type { Inputs } from '@/models/debug'
import type { VisionFile, VisionSettings } from '@/types/app'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiPlayLargeFill,
} from '@remixicon/react'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import FeatureBar from '@/app/components/base/features/new-feature-panel/feature-bar'
import TextGenerationImageUploader from '@/app/components/base/image-uploader/text-generation-image-uploader'
import Input from '@/app/components/base/input'
import Select from '@/app/components/base/select'
import Textarea from '@/app/components/base/textarea'
import Tooltip from '@/app/components/base/tooltip'
import BoolInput from '@/app/components/workflow/nodes/_base/components/before-run-form/bool-input'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum, ModelModeType } from '@/types/app'
import { cn } from '@/utils/classnames'

export type IPromptValuePanelProps = {
  appType: AppModeEnum
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
  const { readonly, modelModeType, modelConfig, setInputs, mode, isAdvancedMode, completionPromptConfig, chatPromptConfig } = useContext(ConfigContext)
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

  // Initialize inputs with default values from promptVariables
  useEffect(() => {
    const newInputs = { ...inputs }
    let hasChanges = false

    promptVariables.forEach((variable) => {
      const { key, default: defaultValue } = variable
      // Only set default value if the field is empty and a default exists
      if (defaultValue !== undefined && defaultValue !== null && defaultValue !== '' && (inputs[key] === undefined || inputs[key] === null || inputs[key] === '')) {
        newInputs[key] = defaultValue
        hasChanges = true
      }
    })

    if (hasChanges)
      setInputs(newInputs)
  }, [promptVariables, inputs, setInputs])

  const canNotRun = useMemo(() => {
    if (mode !== AppModeEnum.COMPLETION)
      return true

    if (isAdvancedMode) {
      if (modelModeType === ModelModeType.chat)
        return chatPromptConfig?.prompt.every(({ text }) => !text)
      return !completionPromptConfig.prompt?.text
    }

    else { return !modelConfig.configs.prompt_template }
  }, [chatPromptConfig?.prompt, completionPromptConfig.prompt?.text, isAdvancedMode, mode, modelConfig.configs.prompt_template, modelModeType])

  const handleInputValueChange = (key: string, value: string | boolean) => {
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
    const newInputs: Inputs = {}
    promptVariables.forEach((item) => {
      newInputs[item.key] = ''
    })
    setInputs(newInputs)
  }

  const setShowAppConfigureFeaturesModal = useAppStore(s => s.setShowAppConfigureFeaturesModal)

  return (
    <>
      <div className="relative z-[1] mx-3 rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg shadow-md">
        <div className={cn('px-4 pt-3', userInputFieldCollapse ? 'pb-3' : 'pb-1')}>
          <div className="flex cursor-pointer items-center gap-0.5 py-0.5" onClick={() => setUserInputFieldCollapse(!userInputFieldCollapse)}>
            <div className="system-md-semibold-uppercase text-text-secondary">{t('inputs.userInputField', { ns: 'appDebug' })}</div>
            {userInputFieldCollapse && <RiArrowRightSLine className="h-4 w-4 text-text-secondary" />}
            {!userInputFieldCollapse && <RiArrowDownSLine className="h-4 w-4 text-text-secondary" />}
          </div>
          {!userInputFieldCollapse && (
            <div className="system-xs-regular mt-1 text-text-tertiary">{t('inputs.completionVarTip', { ns: 'appDebug' })}</div>
          )}
        </div>
        {!userInputFieldCollapse && promptVariables.length > 0 && (
          <div className="px-4 pb-4 pt-3">
            {promptVariables.map(({ key, name, type, options, max_length, required }, index) => (
              <div
                key={key}
                className="mb-4 last-of-type:mb-0"
              >
                <div>
                  {type !== 'checkbox' && (
                    <div className="system-sm-semibold mb-1 flex h-6 items-center gap-1 text-text-secondary">
                      <div className="truncate">{name || key}</div>
                      {!required && <span className="system-xs-regular text-text-tertiary">{t('panel.optional', { ns: 'workflow' })}</span>}
                    </div>
                  )}
                  <div className="grow">
                    {type === 'string' && (
                      <Input
                        value={inputs[key] ? `${inputs[key]}` : ''}
                        onChange={(e) => { handleInputValueChange(key, e.target.value) }}
                        placeholder={name}
                        autoFocus={index === 0}
                        maxLength={max_length}
                        readOnly={readonly}
                      />
                    )}
                    {type === 'paragraph' && (
                      <Textarea
                        className="h-[120px] grow"
                        placeholder={name}
                        value={inputs[key] ? `${inputs[key]}` : ''}
                        onChange={(e) => { handleInputValueChange(key, e.target.value) }}
                        readOnly={readonly}
                      />
                    )}
                    {type === 'select' && (
                      <Select
                        className="w-full"
                        defaultValue={inputs[key] as string}
                        onSelect={(i) => { handleInputValueChange(key, i.value as string) }}
                        items={(options || []).map(i => ({ name: i, value: i }))}
                        allowSearch={false}
                        bgClassName="bg-gray-50"
                        disabled={readonly}
                      />
                    )}
                    {type === 'number' && (
                      <Input
                        type="number"
                        value={inputs[key] ? `${inputs[key]}` : ''}
                        onChange={(e) => { handleInputValueChange(key, e.target.value) }}
                        placeholder={name}
                        autoFocus={index === 0}
                        maxLength={max_length}
                        readOnly={readonly}
                      />
                    )}
                    {type === 'checkbox' && (
                      <BoolInput
                        name={name || key}
                        value={!!inputs[key]}
                        required={required}
                        onChange={(value) => { handleInputValueChange(key, value) }}
                        readonly={readonly}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
            {visionConfig?.enabled && (
              <div className="mt-3 justify-between xl:flex">
                <div className="mr-1 w-[120px] shrink-0 py-2 text-sm text-text-primary">{t('imageUploader.imageUpload', { ns: 'common' })}</div>
                <div className="grow">
                  <TextGenerationImageUploader
                    settings={visionConfig}
                    onFilesChange={files => onVisionFilesChange(files.filter(file => file.progress !== -1).map(fileItem => ({
                      type: 'image',
                      transfer_method: fileItem.type,
                      url: fileItem.url,
                      upload_file_id: fileItem.fileId,
                    })))}
                    disabled={readonly}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        {!userInputFieldCollapse && (
          <div className="flex justify-between border-t border-divider-subtle p-4 pt-3">
            <Button className="w-[72px]" disabled={readonly} onClick={onClear}>{t('operation.clear', { ns: 'common' })}</Button>
            {canNotRun && (
              <Tooltip popupContent={t('otherError.promptNoBeEmpty', { ns: 'appDebug' })}>
                <Button
                  variant="primary"
                  disabled={canNotRun || readonly}
                  onClick={() => onSend?.()}
                  className="w-[96px]"
                >
                  <RiPlayLargeFill className="mr-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('inputs.run', { ns: 'appDebug' })}
                </Button>
              </Tooltip>
            )}
            {!canNotRun && (
              <Button
                variant="primary"
                disabled={canNotRun || readonly}
                onClick={() => onSend?.()}
                className="w-[96px]"
              >
                <RiPlayLargeFill className="mr-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t('inputs.run', { ns: 'appDebug' })}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="mx-3">
        <FeatureBar
          showFileUpload={false}
          isChatMode={appType !== AppModeEnum.COMPLETION}
          onFeatureBarClick={setShowAppConfigureFeaturesModal}
          disabled={readonly}
          hideEditEntrance={readonly}
        />
      </div>
    </>
  )
}

export default React.memo(PromptValuePanel)
