'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import type { Param } from '../../types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
const i18nPrefix = 'workflow.nodes.parameterExtractor'

type Props = {
  payload: Param
  onEdit: () => void
  onDelete: () => void
}

const Item: FC<Props> = ({
  payload,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation()

  return (
    <div className='hover:shadow-xs group relative rounded-lg border-[0.5px] border-gray-200 bg-white px-2.5 py-2'>
      <div className='flex justify-between'>
        <div className='flex items-center'>
          <Variable02 className='text-primary-500 h-3.5 w-3.5' />
          <div className='ml-1 text-[13px] font-medium text-gray-900'>{payload.name}</div>
          <div className='ml-2 text-xs font-normal capitalize text-gray-500'>{payload.type}</div>
        </div>
        {payload.required && (
          <div className='text-xs font-normal uppercase leading-4 text-gray-500'>{t(`${i18nPrefix}.addExtractParameterContent.required`)}</div>
        )}
      </div>
      <div className='mt-0.5 text-xs font-normal leading-[18px] text-gray-500'>{payload.description}</div>
      <div
        className='absolute right-1 top-0 hidden h-full w-[119px] items-center justify-end space-x-1 rounded-lg group-hover:flex'
        style={{
          background: 'linear-gradient(270deg, #FFF 49.99%, rgba(255, 255, 255, 0.00) 98.1%)',
        }}
      >
        <div
          className='cursor-pointer rounded-md p-1 hover:bg-black/5'
          onClick={onEdit}
        >
          <RiEditLine className='h-4 w-4 text-gray-500' />
        </div>

        <div
          className='cursor-pointer rounded-md p-1 hover:bg-black/5'
          onClick={onDelete}
        >
          <RiDeleteBinLine className='h-4 w-4 text-gray-500' />
        </div>
      </div>
    </div>
  )
}
export default React.memo(Item)
