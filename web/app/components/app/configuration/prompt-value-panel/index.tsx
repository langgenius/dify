'use client'
import type { FC } from 'react'
import type { Inputs } from '@/models/debug'
import type { VisionFile, VisionSettings } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiArrowDownSLine, RiArrowRightSLine, RiPlayLargeFill } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useStore as useAppStore } from '@/app/components/app/store'
import FeatureBar from '@/app/components/base/features/new-feature-panel/feature-bar'
import TextGenerationImageUploader from '@/app/components/base/image-uploader/text-generation-image-uploader'
import Input from '@/app/components/base/input'
import BoolInput from '@/app/components/workflow/nodes/_base/components/before-run-form/bool-input'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum, ModelModeType } from '@/types/app'

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
  const {
    readonly,
    canTestAndRun = false,
    modelModeType,
    modelConfig,
    setInputs,
    mode,
    isAdvancedMode,
    completionPromptConfig,
    chatPromptConfig,
  } = useContext(ConfigContext)
  const debugInputReadonly = !canTestAndRun
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
      if (
        defaultValue !== undefined &&
        defaultValue !== null &&
        defaultValue !== '' &&
        (inputs[key] === undefined || inputs[key] === null || inputs[key] === '')
      ) {
        newInputs[key] = defaultValue
        hasChanges = true
      }
    })

    if (hasChanges) setInputs(newInputs)
  }, [promptVariables, inputs, setInputs])

  const canNotRun = useMemo(() => {
    if (mode !== AppModeEnum.COMPLETION) return true

    if (isAdvancedMode) {
      if (modelModeType === ModelModeType.chat)
        return chatPromptConfig?.prompt.every(({ text }) => !text)
      return !completionPromptConfig.prompt?.text
    } else {
      return !modelConfig.configs.prompt_template
    }
  }, [
    chatPromptConfig?.prompt,
    completionPromptConfig.prompt?.text,
    isAdvancedMode,
    mode,
    modelConfig.configs.prompt_template,
    modelModeType,
  ])

  const handleInputValueChange = (key: string, value: string | boolean) => {
    if (debugInputReadonly) return
    if (!(key in promptVariableObj)) return

    const newInputs = { ...inputs }
    promptVariables.forEach((input) => {
      if (input.key === key) newInputs[key] = value
    })
    setInputs(newInputs)
  }

  const onClear = () => {
    if (debugInputReadonly) return
    const newInputs: Inputs = {}
    promptVariables.forEach((item) => {
      newInputs[item.key] = ''
    })
    setInputs(newInputs)
  }

  const setShowAppConfigureFeaturesModal = useAppStore((s) => s.setShowAppConfigureFeaturesModal)

  return (
    <>
      <div className="relative z-1 mx-3 rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg shadow-md">
        <div className={cn('px-4 pt-3', userInputFieldCollapse ? 'pb-3' : 'pb-1')}>
          <button
            type="button"
            className="flex cursor-pointer items-center gap-0.5 border-none bg-transparent px-0 py-0.5 text-left focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            onClick={() => setUserInputFieldCollapse(!userInputFieldCollapse)}
          >
            <div className="system-md-semibold-uppercase text-text-secondary">
              {t(($) => $['inputs.userInputField'], { ns: 'appDebug' })}
            </div>
            {userInputFieldCollapse && (
              <RiArrowRightSLine className="size-4 text-text-secondary" aria-hidden="true" />
            )}
            {!userInputFieldCollapse && (
              <RiArrowDownSLine className="size-4 text-text-secondary" aria-hidden="true" />
            )}
          </button>
          {!userInputFieldCollapse && (
            <div className="mt-1 system-xs-regular text-text-tertiary">
              {t(($) => $['inputs.completionVarTip'], { ns: 'appDebug' })}
            </div>
          )}
        </div>
        {!userInputFieldCollapse && promptVariables.length > 0 && (
          <div className="px-4 pt-3 pb-4">
            {promptVariables.map(({ key, name, type, options, max_length, required }, index) => (
              <div key={key} className="mb-4 last-of-type:mb-0">
                <div>
                  {type !== 'checkbox' && (
                    <div className="mb-1 flex h-6 items-center gap-1 system-sm-semibold text-text-secondary">
                      <div className="truncate">{name || key}</div>
                      {!required && (
                        <span className="system-xs-regular text-text-tertiary">
                          {t(($) => $['panel.optional'], { ns: 'workflow' })}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="grow">
                    {type === 'string' && (
                      <Input
                        value={inputs[key] ? `${inputs[key]}` : ''}
                        onChange={(e) => {
                          handleInputValueChange(key, e.target.value)
                        }}
                        placeholder={name}
                        autoFocus={index === 0}
                        maxLength={max_length}
                        readOnly={debugInputReadonly}
                      />
                    )}
                    {type === 'paragraph' && (
                      <Textarea
                        aria-label={name}
                        className="h-[120px] grow"
                        placeholder={name}
                        value={inputs[key] ? `${inputs[key]}` : ''}
                        onValueChange={(value) => {
                          handleInputValueChange(key, value)
                        }}
                        readOnly={debugInputReadonly}
                      />
                    )}
                    {type === 'select' && (
                      <Select<string>
                        value={
                          typeof inputs[key] === 'string' && inputs[key] !== '' ? inputs[key] : null
                        }
                        disabled={debugInputReadonly}
                        onValueChange={(nextValue) => {
                          if (nextValue == null || nextValue === '') return
                          handleInputValueChange(key, nextValue)
                        }}
                      >
                        <SelectTrigger className="w-full bg-gray-50">
                          {typeof inputs[key] === 'string' && inputs[key] !== ''
                            ? inputs[key]
                            : t(($) => $['placeholder.select'], { ns: 'common' })}
                        </SelectTrigger>
                        <SelectContent>
                          {(options || []).map((option) => (
                            <SelectItem key={option} value={option}>
                              <SelectItemText>{option}</SelectItemText>
                              <SelectItemIndicator />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {type === 'number' && (
                      <Input
                        type="number"
                        value={inputs[key] ? `${inputs[key]}` : ''}
                        onChange={(e) => {
                          handleInputValueChange(key, e.target.value)
                        }}
                        placeholder={name}
                        autoFocus={index === 0}
                        maxLength={max_length}
                        readOnly={debugInputReadonly}
                      />
                    )}
                    {type === 'checkbox' && (
                      <BoolInput
                        name={name || key}
                        value={!!inputs[key]}
                        required={required}
                        onChange={(value) => {
                          handleInputValueChange(key, value)
                        }}
                        readonly={debugInputReadonly}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
            {visionConfig?.enabled && (
              <div className="mt-3 justify-between xl:flex">
                <div className="mr-1 w-[120px] shrink-0 py-2 text-sm text-text-primary">
                  {t(($) => $['imageUploader.imageUpload'], { ns: 'common' })}
                </div>
                <div className="grow">
                  <TextGenerationImageUploader
                    settings={visionConfig}
                    onFilesChange={(files) =>
                      onVisionFilesChange(
                        files
                          .filter((file) => file.progress !== -1)
                          .map((fileItem) => ({
                            type: 'image',
                            transfer_method: fileItem.type,
                            url: fileItem.url,
                            upload_file_id: fileItem.fileId,
                          })),
                      )
                    }
                    disabled={debugInputReadonly}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        {!userInputFieldCollapse && (
          <div className="flex justify-between border-t border-divider-subtle p-4 pt-3">
            <Button className="w-[72px]" disabled={debugInputReadonly} onClick={onClear}>
              {t(($) => $['operation.clear'], { ns: 'common' })}
            </Button>
            {canNotRun && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="primary"
                      disabled={canNotRun || !canTestAndRun}
                      onClick={() => onSend?.()}
                      className="w-[96px]"
                    >
                      <RiPlayLargeFill className="mr-0.5 size-4 shrink-0" aria-hidden="true" />
                      {t(($) => $['inputs.run'], { ns: 'appDebug' })}
                    </Button>
                  }
                />
                <TooltipContent>
                  {t(($) => $['otherError.promptNoBeEmpty'], { ns: 'appDebug' })}
                </TooltipContent>
              </Tooltip>
            )}
            {!canNotRun && (
              <Button
                variant="primary"
                disabled={canNotRun || !canTestAndRun}
                onClick={() => onSend?.()}
                className="w-[96px]"
              >
                <RiPlayLargeFill className="mr-0.5 size-4 shrink-0" aria-hidden="true" />
                {t(($) => $['inputs.run'], { ns: 'appDebug' })}
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
