'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { useContext } from 'use-context-selector'
import { ToastContext } from '@/app/components/base/toast'
import VariableTypeSelector from '@/app/components/workflow/panel/chat-variable-panel/components/variable-type-select'
import RemoveButton from '@/app/components/workflow/nodes/_base/components/remove-button'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'

type Props = {
  index: number
  list: any[]
  onChange: (list: any[]) => void
}

const typeList = [
  ChatVarType.String,
  ChatVarType.Number,
]

export const DEFAULT_OBJECT_VALUE = {
  key: '',
  type: ChatVarType.String,
  value: undefined,
}

const ObjectValueItem: FC<Props> = ({
  index,
  list,
  onChange,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [isFocus, setIsFocus] = useState(false)

  const handleKeyChange = useCallback((index: number) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const newList = produce(list, (draft: any[]) => {
        if (!/^[a-zA-Z0-9_]+$/.test(e.target.value))
          return notify({ type: 'error', message: 'key is can only contain letters, numbers and underscores' })
        draft[index].key = e.target.value
      })
      onChange(newList)
    }
  }, [list, notify, onChange])

  const handleTypeChange = useCallback((index: number) => {
    return (type: ChatVarType) => {
      const newList = produce(list, (draft) => {
        draft[index].type = type
        if (type === ChatVarType.Number)
          draft[index].value = isNaN(Number(draft[index].value)) ? undefined : Number(draft[index].value)
        else
          draft[index].value = draft[index].value ? String(draft[index].value) : undefined
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleValueChange = useCallback((index: number) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const newList = produce(list, (draft: any[]) => {
        draft[index].value = draft[index].type === ChatVarType.String ? e.target.value : isNaN(Number(e.target.value)) ? undefined : Number(e.target.value)
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleItemRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleItemAdd = useCallback(() => {
    const newList = produce(list, (draft: any[]) => {
      draft.push(DEFAULT_OBJECT_VALUE)
    })
    onChange(newList)
  }, [list, onChange])

  const handleFocusChange = useCallback(() => {
    setIsFocus(true)
    if (index === list.length - 1)
      handleItemAdd()
  }, [handleItemAdd, index, list.length])

  return (
    <div className='group flex border-t border-gray-200'>
      {/* Key */}
      <div className='w-[120px] border-r border-gray-200'>
        <input
          className='block px-2 w-full h-7 text-text-secondary system-xs-regular appearance-none outline-none caret-primary-600 hover:bg-state-base-hover focus:bg-components-input-bg-active  placeholder:system-xs-regular placeholder:text-components-input-text-placeholder'
          placeholder={t('workflow.chatVariable.modal.objectKey') || ''}
          value={list[index].key}
          onChange={handleKeyChange(index)}
        />
      </div>
      {/* Type */}
      <div className='w-[96px] border-r border-gray-200'>
        <VariableTypeSelector
          inCell
          value={list[index].type}
          list={typeList}
          onSelect={handleTypeChange(index)}
          popupClassName='w-[120px]'
        />
      </div>
      {/* Value */}
      <div className='relative w-[230px]'>
        <input
          className='block px-2 w-full h-7 text-text-secondary system-xs-regular appearance-none outline-none caret-primary-600 hover:bg-state-base-hover focus:bg-components-input-bg-active  placeholder:system-xs-regular placeholder:text-components-input-text-placeholder'
          placeholder={t('workflow.chatVariable.modal.objectValue') || ''}
          value={list[index].value}
          onChange={handleValueChange(index)}
          onFocus={() => handleFocusChange()}
          onBlur={() => setIsFocus(false)}
          type={list[index].type === ChatVarType.Number ? 'number' : 'text'}
        />
        {list.length > 1 && !isFocus && (
          <RemoveButton
            className='z-10 group-hover:block hidden absolute right-1 top-0.5'
            onClick={handleItemRemove(index)}
          />
        )}
      </div>
    </div>
  )
}
export default React.memo(ObjectValueItem)
