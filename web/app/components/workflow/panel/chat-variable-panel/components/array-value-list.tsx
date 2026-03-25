'use client'
import type { FC } from 'react'
import { RiAddLine } from '@remixicon/react'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import RemoveButton from '@/app/components/workflow/nodes/_base/components/remove-button'

type Props = {
  isString: boolean
  list: any[]
  onChange: (list: any[]) => void
}

const ArrayValueList: FC<Props> = ({
  isString = true,
  list,
  onChange,
}) => {
  const { t } = useTranslation()

  const handleNameChange = useCallback((index: number) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const newList = produce(list, (draft: any[]) => {
        draft[index] = isString ? e.target.value : Number(e.target.value)
      })
      onChange(newList)
    }
  }, [isString, list, onChange])

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
      draft.push(undefined)
    })
    onChange(newList)
  }, [list, onChange])

  return (
    <div className="w-full space-y-2">
      {list.map((item, index) => (
        <div className="flex items-center space-x-1" key={index}>
          <Input
            placeholder={t('chatVariable.modal.arrayValue', { ns: 'workflow' }) || ''}
            value={list[index]}
            onChange={handleNameChange(index)}
            type={isString ? 'text' : 'number'}
          />
          <RemoveButton
            className="!bg-gray-100 !p-2 hover:!bg-gray-200"
            onClick={handleItemRemove(index)}
          />
        </div>
      ))}
      <Button variant="tertiary" className="w-full" onClick={handleItemAdd}>
        <RiAddLine className="mr-1 h-4 w-4" />
        <span>{t('chatVariable.modal.addArrayValue', { ns: 'workflow' })}</span>
      </Button>
    </div>
  )
}
export default React.memo(ArrayValueList)
