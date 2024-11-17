import React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import ConfigContext from '@/context/debug-configuration'
import Input from '@/app/components/base/input'
import Select from '@/app/components/base/select'
import Textarea from '@/app/components/base/textarea'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import type { Inputs } from '@/models/debug'
import cn from '@/utils/classnames'

type Props = {
  inputs: Inputs
}

const ChatUserInput = ({
  inputs,
}: Props) => {
  const { t } = useTranslation()
  const { modelConfig, setInputs } = useContext(ConfigContext)

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

  if (!promptVariables.length)
    return null

  return (
    <div className={cn('bg-components-panel-on-panel-item-bg rounded-xl border-[0.5px] border-components-panel-border-subtle shadow-xs z-[1]')}>
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
      </div>
    </div>
  )
}

export default ChatUserInput
