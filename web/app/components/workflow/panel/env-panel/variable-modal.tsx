import React, { useEffect } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useClickAway } from 'ahooks'
import { RiCloseLine } from '@remixicon/react'
import { useContext } from 'use-context-selector'
import Button from '@/app/components/base/button'
import { ToastContext } from '@/app/components/base/toast'
import { useStore } from '@/app/components/workflow/store'
import type { EnvironmentVariable } from '@/app/components/workflow/types'

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
  const [type, setType] = React.useState<'string' | 'number' | 'secret'>('string')
  const [name, setName] = React.useState('')
  const [value, setValue] = React.useState<any>()

  const ref = React.useRef(null)
  useClickAway(() => {
    onClose()
  }, ref)

  const handleNameChange = (v: string) => {
    if (!v)
      return setName('')
    if (!/^[a-zA-Z0-9_]+$/.test(v))
      return notify({ type: 'error', message: 'name is can only contain letters, numbers and underscores' })
    if (/[0-9]/.test(v))
      return notify({ type: 'error', message: 'name can not start with a number' })
    setName(v)
  }

  const handleSave = () => {
    if (!name)
      return notify({ type: 'error', message: 'name can not be empty' })
    if (!value)
      return notify({ type: 'error', message: 'value can not be empty' })
    if (!env && envList.some(env => env.name === name))
      return notify({ type: 'error', message: 'name is existed' })
    onSave({
      value_type: type,
      name,
      value,
      exportable: true,
    })
    onClose()
  }

  useEffect(() => {
    if (env) {
      setType(env.value_type)
      setName(env.name)
      setValue(env.value)
    }
  }, [env])

  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col w-[360px] bg-white rounded-2xl h-full border-[0.5px] border-black/2 shadow-2xl',
      )}
    >
      <div className='shrink-0 flex items-center justify-between p-4 pb-0 font-semibold text-gray-900'>
        {!env ? t('workflow.env.modal.title') : t('workflow.env.modal.editTitle')}
        <div className='flex items-center'>
          <div
            className='flex items-center justify-center w-6 h-6 cursor-pointer'
            onClick={onClose}
          >
            <RiCloseLine className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      </div>
      <div className='px-4 py-2'>
        {/* type */}
        <div className='mb-4'>
          <div className='mb-1 text-[13px] leading-6 text-gray-700 font-semibold'>{t('workflow.env.modal.type')}</div>
          <div className='flex gap-2'>
            <div className={cn(
              'w-[106px] flex items-center justify-center p-2 rounded-lg bg-gray-50 border border-gray-100 text-[13px] leading-4 text-gray-700 cursor-pointer hover:shadow-xs hover:bg-white hover:border-gray-300',
              type === 'string' && 'text-gray-900 font-medium border-[1.5px] shadow-xs !bg-white border-primary-600 hover:!border-primary-600',
            )} onClick={() => setType('string')}>String</div>
            <div className={cn(
              'w-[106px] flex items-center justify-center p-2 rounded-lg bg-gray-50 border border-gray-100 text-[13px] leading-4 text-gray-700 cursor-pointer hover:shadow-xs hover:bg-white hover:border-gray-300',
              type === 'number' && 'text-gray-900 font-medium border-[1.5px] shadow-xs !bg-white border-primary-600 hover:!border-primary-600',
            )} onClick={() => setType('number')}>Number</div>
            <div className={cn(
              'w-[106px] flex items-center justify-center p-2 rounded-lg bg-gray-50 border border-gray-100 text-[13px] leading-4 text-gray-700 cursor-pointer hover:shadow-xs hover:bg-white hover:border-gray-300',
              type === 'secret' && 'text-gray-900 font-medium border-[1.5px] shadow-xs !bg-white border-primary-600 hover:!border-primary-600',
            )} onClick={() => setType('secret')}>Secret</div>
          </div>
        </div>
        {/* name */}
        <div className='mb-4'>
          <div className='mb-1 text-[13px] leading-6 text-gray-700 font-semibold'>{t('workflow.env.modal.name')}</div>
          <div className='flex'>
            <input
              tabIndex={0}
              className='block px-3 w-full h-9 bg-gray-100 text-sm rounded-lg border border-transparent appearance-none outline-none caret-primary-600 hover:border-[rgba(0,0,0,0.08)] hover:bg-gray-50 focus:bg-white focus:border-gray-300 focus:shadow-xs placeholder:text-sm placeholder:text-gray-400'
              placeholder={t('workflow.env.modal.namePlaceholder') || ''}
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              type='text'
            />
          </div>
        </div>
        {/* value */}
        <div className='mb-4'>
          <div className='mb-1 text-[13px] leading-6 text-gray-700 font-semibold'>{t('workflow.env.modal.value')}</div>
          <div className='flex'>
            <input
              tabIndex={0}
              className='block px-3 w-full h-9 bg-gray-100 text-sm rounded-lg border border-transparent appearance-none outline-none caret-primary-600 hover:border-[rgba(0,0,0,0.08)] hover:bg-gray-50 focus:bg-white focus:border-gray-300 focus:shadow-xs placeholder:text-sm placeholder:text-gray-400'
              placeholder={t('workflow.env.modal.valuePlaceholder') || ''}
              value={value}
              onChange={e => setValue(e.target.value)}
              type={type !== 'number' ? type === 'string' ? 'text' : 'password' : 'number'}
            />
          </div>
        </div>
      </div>
      <div className='p-4 pt-2 flex flex-row-reverse rounded-b-2xl'>
        <div className='flex gap-2'>
          <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
          <Button variant='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
        </div>
      </div>
    </div>
  )
}

export default VariableModal
