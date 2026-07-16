import type {
  EnvironmentVariable,
  EnvironmentVariableValue,
  LLMCompletionParams,
  LLMEnvironmentVariableValue,
} from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid4 } from 'uuid'
import { Infotip } from '@/app/components/base/infotip'
import Input from '@/app/components/base/input'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { checkKeys, replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'

type ModalPropsType = {
  env?: EnvironmentVariable
  onClose: () => void
  onSave: (env: EnvironmentVariable) => void
}

const isLLMEnvironmentVariableValue = (value: unknown): value is LLMEnvironmentVariableValue => {
  if (typeof value !== 'object' || value === null) return false

  return (
    'provider' in value &&
    typeof value.provider === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'mode' in value &&
    typeof value.mode === 'string'
  )
}

const VariableModal = ({ env, onClose, onSave }: ModalPropsType) => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const [type, setType] = React.useState<EnvironmentVariable['value_type']>('string')
  const [name, setName] = React.useState('')
  const [value, setValue] = React.useState<EnvironmentVariableValue>()
  const [description, setDescription] = React.useState<string>('')
  const { activeTextGenerationModelList } = useTextGenerationCurrentProviderAndModelAndModelList()
  const originalLLMMode =
    env?.value_type === 'llm' && isLLMEnvironmentVariableValue(env.value)
      ? env.value.mode
      : undefined
  const selectableModelList = useMemo(() => {
    if (!originalLLMMode) return activeTextGenerationModelList

    return activeTextGenerationModelList
      .map((provider) => ({
        ...provider,
        models: provider.models.filter((model) => model.model_properties.mode === originalLLMMode),
      }))
      .filter((provider) => provider.models.length > 0)
  }, [activeTextGenerationModelList, originalLLMMode])
  const isTypeChangeDisabled = (nextType: EnvironmentVariable['value_type']) =>
    !!env && (env.value_type === 'llm') !== (nextType === 'llm')

  const checkVariableName = (value: string) => {
    const { isValid, errorMessageKey } = checkKeys([value], false)
    if (!isValid) {
      toast.error(
        t(($) => $[`varKeyError.${errorMessageKey}`], {
          ns: 'appDebug',
          key: t(($) => $['env.modal.name'], { ns: 'workflow' }),
        }),
      )
      return false
    }
    return true
  }

  const handleVarNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    replaceSpaceWithUnderscoreInVarNameInput(e.target)
    if (!!e.target.value && !checkVariableName(e.target.value)) return
    setName(e.target.value || '')
  }

  const handleTypeChange = (nextType: EnvironmentVariable['value_type']) => {
    if (isTypeChangeDisabled(nextType)) return
    setType(nextType)

    if (nextType === 'llm') {
      if (!isLLMEnvironmentVariableValue(value)) setValue(undefined)
      return
    }

    if (isLLMEnvironmentVariableValue(value)) {
      setValue('')
      return
    }

    if (nextType === 'number') {
      if (value === undefined || value === '' || Number.isNaN(Number(value))) setValue('')
      return
    }

    if (typeof value === 'number') setValue(String(value))
  }

  const handleModelSelect = ({ provider, modelId }: { provider: string; modelId: string }) => {
    const targetProvider = activeTextGenerationModelList.find(
      (providerItem) => providerItem.provider === provider,
    )
    const targetModel = targetProvider?.models.find((modelItem) => modelItem.model === modelId)
    const mode = targetModel?.model_properties.mode

    if (typeof mode !== 'string') return
    if (originalLLMMode && mode !== originalLLMMode) {
      toast.error(t(($) => $['modelProvider.selector.incompatibleTip'], { ns: 'common' }))
      return
    }

    const completionParams =
      isLLMEnvironmentVariableValue(value) && value.provider === provider && value.name === modelId
        ? (value.completion_params ?? {})
        : {}
    setValue({ provider, name: modelId, mode, completion_params: completionParams })
  }

  const handleCompletionParamsChange = (completionParams: LLMCompletionParams) => {
    if (!isLLMEnvironmentVariableValue(value)) return
    setValue({ ...value, completion_params: completionParams })
  }

  const handleSave = () => {
    if (!checkVariableName(name)) return
    if (
      value === undefined ||
      value === '' ||
      (type === 'llm' && !isLLMEnvironmentVariableValue(value))
    )
      return toast.error(t(($) => $['env.modal.valueRequired'], { ns: 'workflow' }))

    // Add check for duplicate name when editing
    const envList = workflowStore.getState().environmentVariables
    if (env && env.name !== name && envList.some((e) => e.name === name))
      return toast.error(
        t(($) => $['varKeyError.keyAlreadyExists'], {
          ns: 'appDebug',
          key: t(($) => $['env.modal.name'], { ns: 'workflow' }),
        }),
      )
    // Original check for create new variable
    if (!env && envList.some((e) => e.name === name))
      return toast.error(
        t(($) => $['varKeyError.keyAlreadyExists'], {
          ns: 'appDebug',
          key: t(($) => $['env.modal.name'], { ns: 'workflow' }),
        }),
      )

    onSave({
      id: env ? env.id : uuid4(),
      value_type: type,
      name,
      value: type === 'number' ? Number(value) : value,
      description,
    })
    onClose()
  }

  useEffect(() => {
    if (env) {
      setType(env.value_type)
      setName(env.name)
      const envSecrets = workflowStore.getState().envSecrets
      setValue(env.value_type === 'secret' ? envSecrets[env.id] : env.value)
      setDescription(env.description)
    }
  }, [env, workflowStore])

  return (
    <div
      className={cn(
        'flex h-full w-[360px] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl',
      )}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between p-4 pb-0 system-xl-semibold text-text-primary">
        {!env
          ? t(($) => $['env.modal.title'], { ns: 'workflow' })
          : t(($) => $['env.modal.editTitle'], { ns: 'workflow' })}
        <div className="flex items-center">
          <div className="flex size-6 cursor-pointer items-center justify-center" onClick={onClose}>
            <RiCloseLine className="size-4 text-text-tertiary" />
          </div>
        </div>
      </div>
      <div className="px-4 py-2">
        {/* type */}
        <div className="mb-4">
          <div className="mb-1 flex h-6 items-center system-sm-semibold text-text-secondary">
            {t(($) => $['env.modal.type'], { ns: 'workflow' })}
          </div>
          <div
            role="group"
            aria-label={t(($) => $['env.modal.type'], { ns: 'workflow' })}
            className="grid grid-cols-4 gap-2"
          >
            <button
              type="button"
              aria-pressed={type === 'string'}
              disabled={isTypeChangeDisabled('string')}
              className={cn(
                'flex min-w-0 cursor-pointer items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg p-2 system-sm-regular text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
                type === 'string' &&
                  'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg system-sm-medium text-text-primary shadow-xs hover:border-components-option-card-option-selected-border',
              )}
              onClick={() => handleTypeChange('string')}
            >
              String
            </button>
            <button
              type="button"
              aria-pressed={type === 'number'}
              disabled={isTypeChangeDisabled('number')}
              className={cn(
                'flex min-w-0 cursor-pointer items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg p-2 system-sm-regular text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
                type === 'number' &&
                  'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg font-medium text-text-primary shadow-xs hover:border-components-option-card-option-selected-border',
              )}
              onClick={() => handleTypeChange('number')}
            >
              Number
            </button>
            <div className="relative min-w-0">
              <button
                type="button"
                aria-pressed={type === 'secret'}
                disabled={isTypeChangeDisabled('secret')}
                className={cn(
                  'flex w-full min-w-0 cursor-pointer items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg p-2 pr-5 system-sm-regular text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
                  type === 'secret' &&
                    'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg font-medium text-text-primary shadow-xs hover:border-components-option-card-option-selected-border',
                )}
                onClick={() => handleTypeChange('secret')}
              >
                Secret
              </button>
              <Infotip
                aria-label={t(($) => $['env.modal.secretTip'], { ns: 'workflow' })}
                className="absolute top-1/2 right-1 size-3.5 -translate-y-1/2"
                popupClassName="w-[240px]"
              >
                {t(($) => $['env.modal.secretTip'], { ns: 'workflow' })}
              </Infotip>
            </div>
            <button
              type="button"
              aria-pressed={type === 'llm'}
              disabled={isTypeChangeDisabled('llm')}
              className={cn(
                'flex min-w-0 cursor-pointer items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg p-2 system-sm-regular text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
                type === 'llm' &&
                  'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg font-medium text-text-primary shadow-xs hover:border-components-option-card-option-selected-border',
              )}
              onClick={() => handleTypeChange('llm')}
            >
              {t(($) => $['blocks.llm'], { ns: 'workflow' })}
            </button>
          </div>
        </div>
        {/* name */}
        <div className="mb-4">
          <div className="mb-1 flex h-6 items-center system-sm-semibold text-text-secondary">
            {t(($) => $['env.modal.name'], { ns: 'workflow' })}
          </div>
          <div className="flex">
            <Input
              placeholder={t(($) => $['env.modal.namePlaceholder'], { ns: 'workflow' }) || ''}
              value={name}
              onChange={handleVarNameChange}
              onBlur={(e) => checkVariableName(e.target.value)}
              type="text"
            />
          </div>
        </div>
        {/* value */}
        <div className="mb-4">
          <div className="mb-1 flex h-6 items-center system-sm-semibold text-text-secondary">
            {type === 'llm'
              ? t(($) => $['modelProvider.model'], { ns: 'common' })
              : t(($) => $['env.modal.value'], { ns: 'workflow' })}
          </div>
          <div className="flex [&>div]:w-full">
            {type === 'llm' ? (
              <ModelParameterModal
                provider={isLLMEnvironmentVariableValue(value) ? value.provider : ''}
                modelId={isLLMEnvironmentVariableValue(value) ? value.name : ''}
                completionParams={
                  isLLMEnvironmentVariableValue(value) ? (value.completion_params ?? {}) : {}
                }
                modelList={selectableModelList}
                popupClassName="w-[328px]! max-w-[328px]!"
                isAdvancedMode={true}
                setModel={handleModelSelect}
                onCompletionParamsChange={handleCompletionParamsChange}
                hideDebugWithMultipleModel
                debugWithMultipleModel={false}
              />
            ) : type !== 'number' ? (
              <textarea
                className="block h-20 w-full resize-none appearance-none rounded-lg border border-transparent bg-components-input-bg-normal p-2 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:system-sm-regular placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
                value={typeof value === 'string' || typeof value === 'number' ? value : ''}
                placeholder={t(($) => $['env.modal.valuePlaceholder'], { ns: 'workflow' }) || ''}
                onChange={(e) => setValue(e.target.value)}
              />
            ) : (
              <Input
                placeholder={t(($) => $['env.modal.valuePlaceholder'], { ns: 'workflow' }) || ''}
                value={typeof value === 'string' || typeof value === 'number' ? value : ''}
                onChange={(e) => setValue(e.target.value)}
                type="number"
              />
            )}
          </div>
        </div>
        {/* description */}
        <div className="">
          <div className="mb-1 flex h-6 items-center system-sm-semibold text-text-secondary">
            {t(($) => $['env.modal.description'], { ns: 'workflow' })}
          </div>
          <div className="flex">
            <textarea
              className="block h-20 w-full resize-none appearance-none rounded-lg border border-transparent bg-components-input-bg-normal p-2 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:system-sm-regular placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
              value={description}
              placeholder={
                t(($) => $['env.modal.descriptionPlaceholder'], { ns: 'workflow' }) || ''
              }
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-row-reverse rounded-b-2xl p-4 pt-2">
        <div className="flex gap-2">
          <Button onClick={onClose}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
          <Button variant="primary" onClick={handleSave}>
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default VariableModal
