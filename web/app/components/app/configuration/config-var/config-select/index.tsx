'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/24/outline'
import { ReactSortable } from 'react-sortablejs'
import RemoveIcon from '../../base/icons/remove-icon'

import s from './style.module.css'
import cn from '@/utils/classnames'

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
  const [delBtnHoverIndex, setDelBtnHoverIndex] = useState(-1)
  const [focusedIndex, setFocusedIndex] = useState(-1)

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
            ghostClass="opacity-30"
            animation={150}
          >
            {options.map((o, index) => {
              const delBtnHover = delBtnHoverIndex === index
              const inputFocused = focusedIndex === index
              return (
                <div
                  className={cn(
                    `${s.inputWrap} relative border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg`,
                    inputFocused && 'border-components-input-border-active bg-components-input-bg-active',
                    delBtnHover && 'bg-state-destructive-hover',
                  )}
                  key={index}
                >
                  <div className='handle flex items-center justify-center w-3.5 h-3.5 cursor-grab text-text-quaternary'>
                    <svg width="6" height="10" viewBox="0 0 6 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path fillRule="evenodd" clipRule="evenodd" d="M1 2C1.55228 2 2 1.55228 2 1C2 0.447715 1.55228 0 1 0C0.447715 0 0 0.447715 0 1C0 1.55228 0.447715 2 1 2ZM1 6C1.55228 6 2 5.55228 2 5C2 4.44772 1.55228 4 1 4C0.447715 4 0 4.44772 0 5C0 5.55228 0.447715 6 1 6ZM6 1C6 1.55228 5.55228 2 5 2C4.44772 2 4 1.55228 4 1C4 0.447715 4.44772 0 5 0C5.55228 0 6 0.447715 6 1ZM5 6C5.55228 6 6 5.55228 6 5C6 4.44772 5.55228 4 5 4C4.44772 4 4 4.44772 4 5C4 5.55228 4.44772 6 5 6ZM2 9C2 9.55229 1.55228 10 1 10C0.447715 10 0 9.55229 0 9C0 8.44771 0.447715 8 1 8C1.55228 8 2 8.44771 2 9ZM5 10C5.55228 10 6 9.55229 6 9C6 8.44771 5.55228 8 5 8C4.44772 8 4 8.44771 4 9C4 9.55229 4.44772 10 5 10Z" fill="currentColor" />
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
                    onFocus={() => { setFocusedIndex(index) }}
                    onBlur={() => { setFocusedIndex(-1) }}
                    className={'w-full pl-1 pr-8 system-sm-medium text-text-secondary border-0 grow h-8 bg-transparent group focus:outline-none cursor-pointer caret-[#295EFF]'}
                  />
                  <RemoveIcon
                    className={`${s.deleteBtn} absolute top-1/2 translate-y-[-50%] right-1 items-center justify-center w-6 h-6 rounded-lg cursor-pointer`}
                    onClick={() => {
                      onChange(options.filter((_, i) => index !== i))
                    }}
                    onMouseEnter={() => setDelBtnHoverIndex(index)}
                    onMouseLeave={() => setDelBtnHoverIndex(-1)}
                  />
                </div>)
            })}
          </ReactSortable>
        </div>
      )}

      <div
        onClick={() => { onChange([...options, '']) }}
        className='flex items-center h-8 px-2 gap-1 rounded-lg cursor-pointer bg-components-button-tertiary-bg'>
        <PlusIcon className='text-components-button-tertiary-text' width={16} height={16} />
        <div className='text-components-button-tertiary-text system-sm-medium'>{t('appDebug.variableConfig.addOption')}</div>
      </div>
    </div>
  )
}

export default React.memo(ConfigSelect)
