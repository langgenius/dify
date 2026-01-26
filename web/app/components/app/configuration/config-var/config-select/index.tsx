'use client'
import type { FC } from 'react'
import { RiAddLine, RiDeleteBinLine, RiDraggable } from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { cn } from '@/utils/classnames'

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
  const [focusID, setFocusID] = useState<number | null>(null)
  const [deletingID, setDeletingID] = useState<number | null>(null)

  const optionList = options.map((content, index) => {
    return ({
      id: index,
      name: content,
    })
  })

  return (
    <div>
      {options.length > 0 && (
        <div className="mb-1">
          <ReactSortable
            className="space-y-1"
            list={optionList}
            setList={list => onChange(list.map(item => item.name))}
            handle=".handle"
            ghostClass="opacity-50"
            animation={150}
          >
            {options.map((o, index) => (
              <div
                className={cn(
                  'group relative flex items-center rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg pl-2.5 hover:bg-components-panel-on-panel-item-bg-hover',
                  focusID === index && 'border-components-input-border-active bg-components-input-bg-active hover:border-components-input-border-active hover:bg-components-input-bg-active',
                  deletingID === index && 'border-components-input-border-destructive bg-state-destructive-hover hover:border-components-input-border-destructive hover:bg-state-destructive-hover',
                )}
                key={index}
              >
                <RiDraggable className="handle h-4 w-4 cursor-grab text-text-quaternary" />
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
                  className="h-9 w-full grow cursor-pointer overflow-x-auto rounded-lg border-0 bg-transparent pl-1.5 pr-8 text-sm leading-9 text-text-secondary focus:outline-none"
                  onFocus={() => setFocusID(index)}
                  onBlur={() => setFocusID(null)}
                />
                <div
                  role="button"
                  className="absolute right-1.5 top-1/2 block translate-y-[-50%] cursor-pointer rounded-md p-1 text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
                  onClick={() => {
                    onChange(options.filter((_, i) => index !== i))
                    setDeletingID(null)
                  }}
                  onMouseEnter={() => setDeletingID(index)}
                  onMouseLeave={() => setDeletingID(null)}
                >
                  <RiDeleteBinLine className="h-3.5 w-3.5" />
                </div>
              </div>
            ))}
          </ReactSortable>
        </div>
      )}

      <div
        onClick={() => { onChange([...options, '']) }}
        className="mt-1 flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-components-button-tertiary-bg px-3  text-components-button-tertiary-text hover:bg-components-button-tertiary-bg-hover"
      >
        <RiAddLine className="h-4 w-4" />
        <div className="system-sm-medium text-[13px]">{t('variableConfig.addOption', { ns: 'appDebug' })}</div>
      </div>
    </div>
  )
}

export default React.memo(ConfigSelect)
