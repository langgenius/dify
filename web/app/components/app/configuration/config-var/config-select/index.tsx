'use client'
import React, { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/24/outline'
import RemoveIcon from '../../base/icons/remove-icon'

import s from './style.module.css'

export type Options = string[]
export interface IConfigSelectProps {
  options: Options
  onChange: (options: Options) => void
}


const ConfigSelect: FC<IConfigSelectProps> = ({
  options,
  onChange
}) => {
  const { t } = useTranslation()

  return (
    <div>
      {options.length > 0 && (
        <div className='mb-1 space-y-1 '>
          {options.map((o, index) => (
            <div className={`${s.inputWrap} relative`}>
              <input
                key={index}
                type="input"
                value={o || ''}
                onChange={e => {
                  let value = e.target.value
                  onChange(options.map((item, i) => {
                    if (index === i) {
                      return value
                    }
                    return item
                  }))
                }}
                className={`${s.input} w-full px-3 text-sm leading-9 text-gray-900 border-0 grow h-9 bg-transparent focus:outline-none cursor-pointer`}
              />
              <RemoveIcon
                className={`${s.deleteBtn} absolute top-1/2 translate-y-[-50%] right-1.5 items-center justify-center w-6 h-6 rounded-md cursor-pointer hover:bg-[#FEE4E2]`}
                onClick={() => {
                  onChange(options.filter((_, i) => index !== i))
                }}
              />
            </div>
          ))}
        </div>
      )}

      <div
        onClick={() => { onChange([...options, '']) }}
        className='flex items-center h-9 px-3 gap-2 rounded-lg cursor-pointer text-gray-400  bg-gray-100'>
        <PlusIcon width={16} height={16}></PlusIcon>
        <div className='text-gray-500 text-[13px]'>{t('appDebug.variableConig.addOption')}</div>
      </div>
    </div>
  )
}

export default React.memo(ConfigSelect)
