'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { Param } from '../../types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { Edit03, Trash03 } from '@/app/components/base/icons/src/vender/line/general'
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
    <div className='relative px-2.5 py-2 rounded-lg bg-white border-[0.5px] border-gray-200 hover:shadow-xs group'>
      <div className='flex justify-between'>
        <div className='flex items-center'>
          <Variable02 className='w-3.5 h-3.5 text-primary-500' />
          <div className='ml-1 text-[13px] font-medium text-gray-900'>{payload.name}</div>
          <div className='ml-2 text-xs font-normal text-gray-500 capitalize'>{payload.type}</div>
        </div>
        {payload.required && (
          <div className='uppercase leading-4 text-xs font-normal text-gray-500'>{t(`${i18nPrefix}.addExtractParameterContent.required`)}</div>
        )}
      </div>
      <div className='mt-0.5 leading-[18px] text-xs font-normal text-gray-500'>{payload.description}</div>
      <div
        className='group-hover:flex absolute top-0 right-1 hidden h-full items-center w-[119px] justify-end space-x-1 rounded-lg'
        style={{
          background: 'linear-gradient(270deg, #FFF 49.99%, rgba(255, 255, 255, 0.00) 98.1%)',
        }}
      >
        <div
          className='p-1 cursor-pointer rounded-md hover:bg-black/5'
          onClick={onEdit}
        >
          <Edit03 className='w-4 h-4 text-gray-500' />
        </div>

        <div
          className='p-1 cursor-pointer rounded-md hover:bg-black/5'
          onClick={onDelete}
        >
          <Trash03 className='w-4 h-4 text-gray-500' />
        </div>
      </div>
    </div>
  )
}
export default React.memo(Item)
