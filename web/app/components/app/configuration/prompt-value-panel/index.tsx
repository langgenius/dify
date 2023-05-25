'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  PlayIcon,
} from '@heroicons/react/24/solid'
import ConfigContext from '@/context/debug-configuration'
import type { PromptVariable } from '@/models/debug'
import { AppType } from '@/types/app'
import Select from '@/app/components/base/select'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import VarIcon from '../base/icons/var-icon'
import Button from '@/app/components/base/button'

export type IPromptValuePanelProps = {
  appType: AppType
  value?: string
  onChange?: (value: string) => void
  onSend?: () => void
}

const starIcon = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.75 1C2.75 0.723858 2.52614 0.5 2.25 0.5C1.97386 0.5 1.75 0.723858 1.75 1V1.75H1C0.723858 1.75 0.5 1.97386 0.5 2.25C0.5 2.52614 0.723858 2.75 1 2.75H1.75V3.5C1.75 3.77614 1.97386 4 2.25 4C2.52614 4 2.75 3.77614 2.75 3.5V2.75H3.5C3.77614 2.75 4 2.52614 4 2.25C4 1.97386 3.77614 1.75 3.5 1.75H2.75V1Z" fill="#444CE7" />
    <path d="M2.75 8.5C2.75 8.22386 2.52614 8 2.25 8C1.97386 8 1.75 8.22386 1.75 8.5V9.25H1C0.723858 9.25 0.5 9.47386 0.5 9.75C0.5 10.0261 0.723858 10.25 1 10.25H1.75V11C1.75 11.2761 1.97386 11.5 2.25 11.5C2.52614 11.5 2.75 11.2761 2.75 11V10.25H3.5C3.77614 10.25 4 10.0261 4 9.75C4 9.47386 3.77614 9.25 3.5 9.25H2.75V8.5Z" fill="#444CE7" />
    <path d="M6.96667 1.32051C6.8924 1.12741 6.70689 1 6.5 1C6.29311 1 6.10759 1.12741 6.03333 1.32051L5.16624 3.57494C5.01604 3.96546 4.96884 4.078 4.90428 4.1688C4.8395 4.2599 4.7599 4.3395 4.6688 4.40428C4.578 4.46884 4.46546 4.51604 4.07494 4.66624L1.82051 5.53333C1.62741 5.60759 1.5 5.79311 1.5 6C1.5 6.20689 1.62741 6.39241 1.82051 6.46667L4.07494 7.33376C4.46546 7.48396 4.578 7.53116 4.6688 7.59572C4.7599 7.6605 4.8395 7.7401 4.90428 7.8312C4.96884 7.922 5.01604 8.03454 5.16624 8.42506L6.03333 10.6795C6.1076 10.8726 6.29311 11 6.5 11C6.70689 11 6.89241 10.8726 6.96667 10.6795L7.83376 8.42506C7.98396 8.03454 8.03116 7.922 8.09572 7.8312C8.1605 7.7401 8.2401 7.6605 8.3312 7.59572C8.422 7.53116 8.53454 7.48396 8.92506 7.33376L11.1795 6.46667C11.3726 6.39241 11.5 6.20689 11.5 6C11.5 5.79311 11.3726 5.60759 11.1795 5.53333L8.92506 4.66624C8.53454 4.51604 8.422 4.46884 8.3312 4.40428C8.2401 4.3395 8.1605 4.2599 8.09572 4.1688C8.03116 4.078 7.98396 3.96546 7.83376 3.57494L6.96667 1.32051Z" fill="#444CE7" />
  </svg>
)

const PromptValuePanel: FC<IPromptValuePanelProps> = ({
  appType,
  value,
  onChange,
  onSend,
}) => {
  const { t } = useTranslation()
  const { modelConfig, inputs, setInputs } = useContext(ConfigContext)
  const promptTemplate = modelConfig.configs.prompt_template
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

  const promptPreview = (
    <div className='pt-3 pb-4 rounded-t-xl bg-indigo-25'>
      <div className="px-4">
        <div className="flex items-center space-x-1">
          {starIcon}
          <div className="text-xs font-medium text-indigo-600 uppercase">{t('appDebug.inputs.previewTitle')}</div>
        </div>
        <div className='mt-2  leading-normal'>
          {
            (promptTemplate && promptTemplate?.trim()) ? (
              <div
                className="max-h-48 overflow-y-auto text-sm text-gray-700 break-all"
                dangerouslySetInnerHTML={{
                  __html: format(replaceStringWithValuesWithFormat(promptTemplate.replace(/</g, '&lt;').replace(/>/g, '&gt;'), promptVariables, inputs)),
                }}
              >
              </div>
            ) : (
              <div className='text-xs text-gray-500'>{t('appDebug.inputs.noPrompt')}</div>
            )
          }
        </div>
      </div>
    </div>
  )

  return (
    <div className="pb-5 border border-gray-200 bg-white rounded-xl" style={{
      boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
    }}>
      {promptPreview}

      <div className="mt-5 px-4">
        <div className='mb-4 '>
          <div className='flex items-center space-x-1'>
            <div className='flex items-center justify-center w-4 h-4'><VarIcon /></div>
            <div className='text-sm font-semibold text-gray-800'>{t('appDebug.inputs.userInputField')}</div>
          </div>
          {appType === AppType.completion && promptVariables.length > 0 && (
            <div className="mt-1 text-xs leading-normal text-gray-500">{t('appDebug.inputs.completionVarTip')}</div>
          )}
        </div>
        {
          promptVariables.length > 0 ? (
            <div className="space-y-3 ">
              {promptVariables.map(({ key, name, type, options, max_length, required }) => (
                <div key={key} className="flex items-center justify-between">
                  <div className="mr-1 shrink-0 w-[120px] text-sm text-gray-900">{name || key}</div>
                  {type === 'select' ? (
                    <Select
                      className='w-full'
                      defaultValue={inputs[key] as string}
                      onSelect={(i) => { handleInputValueChange(key, i.value as string) }}
                      items={(options || []).map(i => ({ name: i, value: i }))}
                      allowSearch={false}
                      bgClassName='bg-gray-50'
                    />
                  ) : (
                    <input
                      className="w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
                      placeholder={`${name}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                      type="text"
                      value={inputs[key] ? `${inputs[key]}` : ''}
                      onChange={(e) => { handleInputValueChange(key, e.target.value) }}
                      maxLength={max_length || DEFAULT_VALUE_MAX_LEN}
                    />
                  )}

                </div>
              ))}
            </div>
          ) : (
            <div className='text-xs text-gray-500'>{t('appDebug.inputs.noVar')}</div>
          )
        }
      </div>

      {
        appType === AppType.completion && (
          <div className='px-4'>
            <div className="mt-5 border-b border-gray-100"></div>
            <div className="mt-4">
              <div>
                <div className="text-[13px] text-gray-900 font-medium">{t('appDebug.inputs.queryTitle')}</div>
                <div className="mt-2 mb-4 overflow-hidden border border-gray-200 rounded-lg grow bg-gray-50 ">
                  <div className="px-4 py-2 rounded-t-lg bg-gray-50">
                    <textarea
                      rows={4}
                      className="w-full px-0 text-sm text-gray-900 border-0 bg-gray-50 focus:outline-none placeholder:bg-gray-50"
                      placeholder={t('appDebug.inputs.queryPlaceholder') as string}
                      value={value}
                      onChange={e => onChange && onChange(e.target.value)}
                    ></textarea>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                    <div className="flex pl-0 space-x-1 sm:pl-2">
                      <span className="bg-gray-100 text-gray-500 text-xs font-medium mr-2 px-2.5 py-0.5 rounded cursor-pointer">{value?.length}</span>
                    </div>
                    <Button
                      type="primary"
                      onClick={() => onSend && onSend()}
                      className="w-[80px] !h-8">
                      <PlayIcon className="shrink-0 w-4 h-4 mr-1" aria-hidden="true" />
                      <span className='uppercase text-[13px]'>{t('appDebug.inputs.run')}</span>
                    </Button>
                  </div>
                </div>
              </div>
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
