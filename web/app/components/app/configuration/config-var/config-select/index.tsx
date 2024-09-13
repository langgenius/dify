'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/24/outline'
import { ReactSortable } from 'react-sortablejs'
import RemoveIcon from '../../base/icons/remove-icon'

import s from './style.module.css'

export type Options = string[]
export type IConfigSelectProps = {
  options: Options
  onChange: (options: Options) => void
}

const ConfigSelect: FC<IConfigSelectProps> = ({
  options,
  onChange,
}) => {
  const { t } = useTranslation()

  const optionList = options.map((content, index) => {
    return ({
      id: index,
      name: content,
    })
  })

  return (
    <div>
      {options.length > 0 && (
        <div className='mb-1'>
          <ReactSortable
            className="space-y-1"
            list={optionList}
            setList={list => onChange(list.map(item => item.name))}
            handle='.handle'
            ghostClass="opacity-50"
            animation={150}
          >
            {options.map((o, index) => (
              <div className={`${s.inputWrap} relative`} key={index}>
                <div className='handle flex items-center justify-center w-4 h-4 cursor-grab'>
                  <svg width="6" height="10" viewBox="0 0 6 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" clipRule="evenodd" d="M1 2C1.55228 2 2 1.55228 2 1C2 0.447715 1.55228 0 1 0C0.447715 0 0 0.447715 0 1C0 1.55228 0.447715 2 1 2ZM1 6C1.55228 6 2 5.55228 2 5C2 4.44772 1.55228 4 1 4C0.447715 4 0 4.44772 0 5C0 5.55228 0.447715 6 1 6ZM6 1C6 1.55228 5.55228 2 5 2C4.44772 2 4 1.55228 4 1C4 0.447715 4.44772 0 5 0C5.55228 0 6 0.447715 6 1ZM5 6C5.55228 6 6 5.55228 6 5C6 4.44772 5.55228 4 5 4C4.44772 4 4 4.44772 4 5C4 5.55228 4.44772 6 5 6ZM2 9C2 9.55229 1.55228 10 1 10C0.447715 10 0 9.55229 0 9C0 8.44771 0.447715 8 1 8C1.55228 8 2 8.44771 2 9ZM5 10C5.55228 10 6 9.55229 6 9C6 8.44771 5.55228 8 5 8C4.44772 8 4 8.44771 4 9C4 9.55229 4.44772 10 5 10Z" fill="#98A2B3" />
                  </svg>
                </div>
                <input
                  key={index}
                  type="input"
                  value={o || ''}
                  onChange={(e) => {
                    const value = e.target.value
                    onChange(options.map((item, i) => {
                      if (index === i)
                        return value

                      return item
                    }))
                  }}
                  className={'w-full pl-1.5 pr-8 text-sm leading-9 text-gray-900 border-0 grow h-9 bg-transparent focus:outline-none cursor-pointer'}
                />
                <RemoveIcon
                  className={`${s.deleteBtn} absolute top-1/2 translate-y-[-50%] right-1.5 items-center justify-center w-6 h-6 rounded-md cursor-pointer hover:bg-[#FEE4E2]`}
                  onClick={() => {
                    onChange(options.filter((_, i) => index !== i))
                  }}
                />
              </div>
            ))}
          </ReactSortable>
        </div>
      )}

      <div
        onClick={() => { onChange([...options, '']) }}
        className='flex items-center h-9 px-3 gap-2 rounded-lg cursor-pointer text-gray-400  bg-gray-100'>
        <PlusIcon width={16} height={16}></PlusIcon>
        <div className='text-gray-500 text-[13px]'>{t('appDebug.variableConfig.addOption')}</div>
      </div>
    </div>
  )
}

export default React.memo(ConfigSelect)
