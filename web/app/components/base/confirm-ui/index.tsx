'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../button'

export type IConfirmUIProps = {
  type: 'info' | 'warning'
  title: string
  content: string
  confirmText?: string
  onConfirm: () => void
  cancelText?: string
  onCancel: () => void
}

const ConfirmUI: FC<IConfirmUIProps> = ({
  type,
  title,
  content,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation()
  return (
    <div className="w-[420px] max-w-full rounded-lg p-7 bg-white">
      <div className='flex items-center'>
        {type === 'info' && (<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.3333 21.3333H16V16H14.6667M16 10.6667H16.0133M28 16C28 17.5759 27.6896 19.1363 27.0866 20.5922C26.4835 22.0481 25.5996 23.371 24.4853 24.4853C23.371 25.5996 22.0481 26.4835 20.5922 27.0866C19.1363 27.6896 17.5759 28 16 28C14.4241 28 12.8637 27.6896 11.4078 27.0866C9.95189 26.4835 8.62902 25.5996 7.51472 24.4853C6.40042 23.371 5.5165 22.0481 4.91345 20.5922C4.31039 19.1363 4 17.5759 4 16C4 12.8174 5.26428 9.76516 7.51472 7.51472C9.76516 5.26428 12.8174 4 16 4C19.1826 4 22.2348 5.26428 24.4853 7.51472C26.7357 9.76516 28 12.8174 28 16Z" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>)}
        {type === 'warning' && (<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 10.6667V16M16 21.3333H16.0133M28 16C28 17.5759 27.6896 19.1363 27.0866 20.5922C26.4835 22.0481 25.5996 23.371 24.4853 24.4853C23.371 25.5996 22.0481 26.4835 20.5922 27.0866C19.1363 27.6896 17.5759 28 16 28C14.4241 28 12.8637 27.6896 11.4078 27.0866C9.95189 26.4835 8.62902 25.5996 7.51472 24.4853C6.40042 23.371 5.5165 22.0481 4.91345 20.5922C4.31039 19.1363 4 17.5759 4 16C4 12.8174 5.26428 9.76516 7.51472 7.51472C9.76516 5.26428 12.8174 4 16 4C19.1826 4 22.2348 5.26428 24.4853 7.51472C26.7357 9.76516 28 12.8174 28 16Z" stroke="#FACA15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        )}
        <div className='ml-4 text-lg text-gray-900'>{title}</div>
      </div>

      <div className='mt-1 ml-12'>
        <div className='text-sm leading-normal text-gray-500'>{content}</div>
      </div>

      <div className='flex gap-3 mt-4 ml-12'>
        <Button type='primary' onClick={onConfirm} className='flex items-center justify-center w-20 text-center text-white rounded-lg cursor-pointer h-9 '>{confirmText || t('common.operation.confirm')}</Button>
        <Button onClick={onCancel} className='flex items-center justify-center w-20 text-center text-gray-500 border rounded-lg cursor-pointer h-9 border-color-gray-200'>{cancelText || t('common.operation.cancel')}</Button>
      </div>
    </div>

  )
}
export default React.memo(ConfirmUI)
