import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid4 } from 'uuid'
import { RiCloseLine } from '@remixicon/react'
import { useContext } from 'use-context-selector'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Tooltip from '@/app/components/base/tooltip'
import { ToastContext } from '@/app/components/base/toast'
import { useStore } from '@/app/components/workflow/store'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import { checkKeys } from '@/utils/var'

export type ModalPropsType = {
  env?: EnvironmentVariable
  onClose: () => void
  onSave: (env: EnvironmentVariable) => void
}
const VariableModal = ({
  env,
  onClose,
  onSave,
}: ModalPropsType) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const envList = useStore(s => s.environmentVariables)
  const envSecrets = useStore(s => s.envSecrets)
  const [type, setType] = React.useState<'string' | 'number' | 'secret'>('string')
  const [name, setName] = React.useState('')
  const [value, setValue] = React.useState<any>()

  const checkVariableName = (value: string) => {
    const { isValid, errorMessageKey } = checkKeys([value], false)
    if (!isValid) {
      notify({
        type: 'error',
        message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: t('workflow.env.modal.name') }),
      })
      return false
    }
    return true
  }

  const handleSave = () => {
    if (!checkVariableName(name))
      return
    if (!value)
      return notify({ type: 'error', message: 'value can not be empty' })
    if (!env && envList.some(env => env.name === name))
      return notify({ type: 'error', message: 'name is existed' })
    onSave({
      id: env ? env.id : uuid4(),
      value_type: type,
      name,
      value: type === 'number' ? Number(value) : value,
    })
    onClose()
  }

  useEffect(() => {
    if (env) {
      setType(env.value_type)
      setName(env.name)
      setValue(env.value_type === 'secret' ? envSecrets[env.id] : env.value)
    }
  }, [env, envSecrets])

  return (
    <div
      className={cn('flex h-full w-[360px] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl')}
    >
      <div className='system-xl-semibold mb-3 flex shrink-0 items-center justify-between p-4 pb-0 text-text-primary'>
        {!env ? t('workflow.env.modal.title') : t('workflow.env.modal.editTitle')}
        <div className='flex items-center'>
          <div
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
            onClick={onClose}
          >
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className='px-4 py-2'>
        {/* type */}
        <div className='mb-4'>
          <div className='system-sm-semibold mb-1 flex h-6 items-center text-text-secondary'>{t('workflow.env.modal.type')}</div>
          <div className='flex gap-2'>
            <div className={cn(
              'radius-md system-sm-regular flex w-[106px] cursor-pointer items-center justify-center border border-components-option-card-option-border bg-components-option-card-option-bg p-2 text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
              type === 'string' && 'system-sm-medium border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary shadow-xs hover:border-components-option-card-option-selected-border',
            )} onClick={() => setType('string')}>String</div>
            <div className={cn(
              'radius-md system-sm-regular flex w-[106px] cursor-pointer items-center justify-center border border-components-option-card-option-border bg-components-option-card-option-bg p-2 text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
              type === 'number' && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg font-medium text-text-primary shadow-xs hover:border-components-option-card-option-selected-border',
            )} onClick={() => {
              setType('number')
              if (!(/^[0-9]$/).test(value))
                setValue('')
            }}>Number</div>
            <div className={cn(
              'radius-md system-sm-regular flex w-[106px] cursor-pointer items-center justify-center border border-components-option-card-option-border bg-components-option-card-option-bg p-2 text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
              type === 'secret' && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg font-medium text-text-primary shadow-xs hover:border-components-option-card-option-selected-border',
            )} onClick={() => setType('secret')}>
              <span>Secret</span>
              <Tooltip
                popupContent={
                  <div className='w-[240px]'>
                    {t('workflow.env.modal.secretTip')}
                  </div>
                }
                triggerClassName='ml-0.5 w-3.5 h-3.5'
              />
            </div>
          </div>
        </div>
        {/* name */}
        <div className='mb-4'>
          <div className='system-sm-semibold mb-1 flex h-6 items-center text-text-secondary'>{t('workflow.env.modal.name')}</div>
          <div className='flex'>
            <Input
              placeholder={t('workflow.env.modal.namePlaceholder') || ''}
              value={name}
              onChange={e => setName(e.target.value || '')}
              onBlur={e => checkVariableName(e.target.value)}
              type='text'
            />
          </div>
        </div>
        {/* value */}
        <div className=''>
          <div className='system-sm-semibold mb-1 flex h-6 items-center text-text-secondary'>{t('workflow.env.modal.value')}</div>
          <div className='flex'>
            <Input
              placeholder={t('workflow.env.modal.valuePlaceholder') || ''}
              value={value}
              onChange={e => setValue(e.target.value)}
              type={type !== 'number' ? 'text' : 'number'}
            />
          </div>
        </div>
      </div>
      <div className='flex flex-row-reverse rounded-b-2xl p-4 pt-2'>
        <div className='flex gap-2'>
          <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
          <Button variant='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
        </div>
      </div>
    </div>
  )
}

export default VariableModal
