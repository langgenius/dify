'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import VarHighlight from '../../base/var-highlight'
import Button from '@/app/components/base/button'

export type IConfirmAddVarProps = {
  varNameArr: string[]
  onConfirm: () => void
  onCancel: () => void
  onHide: () => void
}

const VarIcon = (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.8683 0.704745C13.7051 0.374685 13.3053 0.239393 12.9752 0.402563C12.6452 0.565732 12.5099 0.965573 12.673 1.29563C13.5221 3.01316 13.9999 4.94957 13.9999 7.00019C13.9999 9.05081 13.5221 10.9872 12.673 12.7047C12.5099 13.0348 12.6452 13.4346 12.9752 13.5978C13.3053 13.761 13.7051 13.6257 13.8683 13.2956C14.8063 11.3983 15.3333 9.26009 15.3333 7.00019C15.3333 4.74029 14.8063 2.60209 13.8683 0.704745Z" fill="#FD853A" />
    <path d="M3.32687 1.29563C3.49004 0.965573 3.35475 0.565732 3.02469 0.402563C2.69463 0.239393 2.29479 0.374685 2.13162 0.704745C1.19364 2.60209 0.666626 4.74029 0.666626 7.00019C0.666626 9.26009 1.19364 11.3983 2.13162 13.2956C2.29479 13.6257 2.69463 13.761 3.02469 13.5978C3.35475 13.4346 3.49004 13.0348 3.32687 12.7047C2.47779 10.9872 1.99996 9.05081 1.99996 7.00019C1.99996 4.94957 2.47779 3.01316 3.32687 1.29563Z" fill="#FD853A" />
    <path d="M9.33238 4.8413C9.74208 4.36081 10.3411 4.08337 10.9726 4.08337H11.0324C11.4006 4.08337 11.6991 4.38185 11.6991 4.75004C11.6991 5.11823 11.4006 5.41671 11.0324 5.41671H10.9726C10.7329 5.41671 10.5042 5.52196 10.347 5.7064L8.78693 7.536L9.28085 9.27382C9.29145 9.31112 9.32388 9.33337 9.35696 9.33337H10.2864C10.6545 9.33337 10.953 9.63185 10.953 10C10.953 10.3682 10.6545 10.6667 10.2864 10.6667H9.35696C8.72382 10.6667 8.17074 10.245 7.99832 9.63834L7.74732 8.75524L6.76373 9.90878C6.35403 10.3893 5.75501 10.6667 5.1235 10.6667H5.06372C4.69553 10.6667 4.39705 10.3682 4.39705 10C4.39705 9.63185 4.69553 9.33337 5.06372 9.33337H5.1235C5.3632 9.33337 5.59189 9.22812 5.74915 9.04368L7.30926 7.21399L6.81536 5.47626C6.80476 5.43897 6.77233 5.41671 6.73925 5.41671H5.80986C5.44167 5.41671 5.14319 5.11823 5.14319 4.75004C5.14319 4.38185 5.44167 4.08337 5.80986 4.08337H6.73925C7.37239 4.08337 7.92547 4.50508 8.0979 5.11174L8.34887 5.99475L9.33238 4.8413Z" fill="#FD853A" />
  </svg>
)

const ConfirmAddVar: FC<IConfirmAddVarProps> = ({
  varNameArr,
  onConfirm,
  onCancel,
  // onHide,
}) => {
  const { t } = useTranslation()
  const mainContentRef = useRef<HTMLDivElement>(null)
  // new prompt editor blur trigger click...
  // useClickAway(() => {
  //   onHide()
  // }, mainContentRef)
  return (
    <div className='absolute inset-0  flex items-center justify-center rounded-xl'
      style={{
        backgroundColor: 'rgba(35, 56, 118, 0.2)',
      }}>
      <div
        ref={mainContentRef}
        className='w-[420px] rounded-xl bg-gray-50 p-6'
        style={{
          boxShadow: '0px 12px 16px -4px rgba(16, 24, 40, 0.08), 0px 4px 6px -2px rgba(16, 24, 40, 0.03)',
        }}
      >
        <div className='flex items-start space-x-3'>
          <div
            className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-100'
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              boxShadow: '0px 12px 16px -4px rgba(16, 24, 40, 0.08), 0px 4px 6px -2px rgba(16, 24, 40, 0.03)',
            }}
          >{VarIcon}</div>
          <div className='grow-1'>
            <div className='text-sm font-medium text-gray-900'>{t('appDebug.autoAddVar')}</div>
            <div className='mt-[15px] flex max-h-[66px] flex-wrap space-x-1 overflow-y-auto px-1'>
              {varNameArr.map(name => (
                <VarHighlight key={name} name={name} />
              ))}
            </div>
          </div>
        </div>
        <div className='mt-7 flex justify-end space-x-2'>
          <Button onClick={onCancel}>{t('common.operation.cancel')}</Button>
          <Button variant='primary' onClick={onConfirm}>{t('common.operation.add')}</Button>
        </div>
      </div>

    </div>
  )
}
export default React.memo(ConfirmAddVar)
