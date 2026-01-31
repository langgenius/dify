import type { Inputs } from '@/models/debug'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Input from '@/app/components/base/input'
import Select from '@/app/components/base/select'
import Textarea from '@/app/components/base/textarea'
import BoolInput from '@/app/components/workflow/nodes/_base/components/before-run-form/bool-input'
import ConfigContext from '@/context/debug-configuration'
import { cn } from '@/utils/classnames'

type Props = {
  inputs: Inputs
}

const ChatUserInput = ({
  inputs,
}: Props) => {
  const { t } = useTranslation()
  const { modelConfig, setInputs, readonly } = useContext(ConfigContext)

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

  if (!promptVariables.length)
    return null

  return (
    <div className={cn('z-[1] rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg shadow-xs')}>
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
      </div>
    </div>
  )
}

export default ChatUserInput
