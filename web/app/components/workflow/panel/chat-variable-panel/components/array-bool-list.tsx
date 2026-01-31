'use client'
import type { FC } from 'react'
import { RiAddLine } from '@remixicon/react'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import RemoveButton from '@/app/components/workflow/nodes/_base/components/remove-button'
import { cn } from '@/utils/classnames'
import BoolValue from './bool-value'

type Props = {
  className?: string
  list: boolean[]
  onChange: (list: boolean[]) => void
}

const ArrayValueList: FC<Props> = ({
  className,
  list,
  onChange,
}) => {
  const { t } = useTranslation()

  const handleChange = useCallback((index: number) => {
    return (value: boolean) => {
      const newList = produce(list, (draft: any[]) => {
        draft[index] = value
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
      draft.push(false)
    })
    onChange(newList)
  }, [list, onChange])

  return (
    <div className={cn('w-full space-y-2', className)}>
      {list.map((item, index) => (
        <div className="flex items-center space-x-1" key={index}>
          <BoolValue
            value={item}
            onChange={handleChange(index)}
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
