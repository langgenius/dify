'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  RiArrowDownSLine,
  RiArrowRightLine,
} from '@remixicon/react'
import {
  PlayIcon,
} from '@heroicons/react/24/solid'
import ConfigContext from '@/context/debug-configuration'
import type { Inputs, PromptVariable } from '@/models/debug'
import { AppType, ModelModeType } from '@/types/app'
import Select from '@/app/components/base/select'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import TextGenerationImageUploader from '@/app/components/base/image-uploader/text-generation-image-uploader'
import type { VisionFile, VisionSettings } from '@/types/app'

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

  const promptVariableObj = (() => {
    const obj: Record<string, boolean> = {}
    promptVariables.forEach((input) => {
      obj[input.key] = true
    })
    return obj
  })()

  const canNotRun = (() => {
    if (mode !== AppType.completion)
      return true

    if (isAdvancedMode) {
      if (modelModeType === ModelModeType.chat)
        return chatPromptConfig.prompt.every(({ text }) => !text)
      return !completionPromptConfig.prompt?.text
    }

    else { return !modelConfig.configs.prompt_template }
  })()
  const renderRunButton = () => {
    return (
      <Button
        variant="primary"
        disabled={canNotRun}
        onClick={() => onSend && onSend()}
        className="w-[80px] !h-8">
        <PlayIcon className="shrink-0 w-4 h-4 mr-1" aria-hidden="true" />
        <span className='uppercase text-[13px]'>{t('appDebug.inputs.run')}</span>
      </Button>
    )
  }
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

  return (
    <div className="pb-3 border border-gray-200 bg-white rounded-xl" style={{
      boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
    }}>
      <div className={'mt-3 px-4 bg-white'}>
        <div className={
          `${!userInputFieldCollapse && 'mb-2'}`
        }>
          <div className='flex items-center space-x-1 cursor-pointer' onClick={() => setUserInputFieldCollapse(!userInputFieldCollapse)}>
            {
              userInputFieldCollapse
                ? <RiArrowRightLine className='w-3 h-3 text-gray-300' />
                : <RiArrowDownSLine className='w-3 h-3 text-gray-300' />
            }
            <div className='text-xs font-medium text-gray-800 uppercase'>{t('appDebug.inputs.userInputField')}</div>
          </div>
          {appType === AppType.completion && promptVariables.length > 0 && !userInputFieldCollapse && (
            <div className="mt-1 text-xs leading-normal text-gray-500">{t('appDebug.inputs.completionVarTip')}</div>
          )}
        </div>
        {!userInputFieldCollapse && (
          <>
            {
              promptVariables.length > 0
                ? (
                  <div className="space-y-3 ">
                    {promptVariables.map(({ key, name, type, options, max_length, required }) => (
                      <div key={key} className="xl:flex justify-between">
                        <div className="mr-1 py-2 shrink-0 w-[120px] text-sm text-gray-900">{name || key}</div>
                        {type === 'select' && (
                          <Select
                            className='w-full'
                            defaultValue={inputs[key] as string}
                            onSelect={(i) => { handleInputValueChange(key, i.value as string) }}
                            items={(options || []).map(i => ({ name: i, value: i }))}
                            allowSearch={false}
                            bgClassName='bg-gray-50'
                          />
                        )
                        }
                        {type === 'string' && (
                          <input
                            className="w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
                            placeholder={`${name}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                            type="text"
                            value={inputs[key] ? `${inputs[key]}` : ''}
                            onChange={(e) => { handleInputValueChange(key, e.target.value) }}
                            maxLength={max_length || DEFAULT_VALUE_MAX_LEN}
                          />
                        )}
                        {type === 'paragraph' && (
                          <textarea
                            className="w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-[120px] bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
                            placeholder={`${name}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                            value={inputs[key] ? `${inputs[key]}` : ''}
                            onChange={(e) => { handleInputValueChange(key, e.target.value) }}
                          />
                        )}
                        {type === 'number' && (
                          <input
                            className="w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
                            placeholder={`${name}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                            type="number"
                            value={inputs[key] ? `${inputs[key]}` : ''}
                            onChange={(e) => { handleInputValueChange(key, e.target.value) }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )
                : (
                  <div className='text-xs text-gray-500'>{t('appDebug.inputs.noVar')}</div>
                )
            }
            {
              appType === AppType.completion && visionConfig?.enabled && (
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
              )
            }
          </>
        )
        }
      </div>

      {
        appType === AppType.completion && (
          <div>
            <div className="mt-5 border-b border-gray-100"></div>
            <div className="flex justify-between mt-4 px-4">
              <Button
                onClick={onClear}
                disabled={false}
              >
                <span className='text-[13px]'>{t('common.operation.clear')}</span>
              </Button>

              {canNotRun
                ? (<Tooltip
                  popupContent={t('appDebug.otherError.promptNoBeEmpty')}
                  needsDelay
                >
                  {renderRunButton()}
                </Tooltip>)
                : renderRunButton()}
            </div>
          </div>
        )
      }
    </div>
  )
}

export default React.memo(PromptValuePanel)

function replaceStringWithValuesWithFormat(str: string, promptVariables: PromptVariable[], inputs: Record<string, any>) {
  return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const name = inputs[key]
    if (name) { // has set value
      return `<div class='inline-block px-1 rounded-md text-gray-900' style='background: rgba(16, 24, 40, 0.1)'>${name}</div>`
    }

    const valueObj: PromptVariable | undefined = promptVariables.find(v => v.key === key)
    return `<div class='inline-block px-1 rounded-md text-gray-500' style='background: rgba(16, 24, 40, 0.05)'>${valueObj ? valueObj.name : match}</div>`
  })
}

export function replaceStringWithValues(str: string, promptVariables: PromptVariable[], inputs: Record<string, any>) {
  return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const name = inputs[key]
    if (name) { // has set value
      return name
    }

    const valueObj: PromptVariable | undefined = promptVariables.find(v => v.key === key)
    return valueObj ? `{{${valueObj.name}}}` : match
  })
}

// \n -> br
function format(str: string) {
  return str.replaceAll('\n', '<br>')
}
