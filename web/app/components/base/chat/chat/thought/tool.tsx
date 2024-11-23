'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  RiArrowDownSLine,
  RiLoader2Line,
} from '@remixicon/react'
import type { ToolInfoInThought } from '../type'
import Panel from './panel'
import cn from '@/utils/classnames'
import { CheckCircle } from '@/app/components/base/icons/src/vender/solid/general'
import { DataSet as DataSetIcon } from '@/app/components/base/icons/src/public/thought'
import type { Emoji } from '@/app/components/tools/types'
import AppIcon from '@/app/components/base/app-icon'

type Props = {
  payload: ToolInfoInThought
  allToolIcons?: Record<string, string | Emoji>
}

const getIcon = (toolName: string, allToolIcons: Record<string, string | Emoji>) => {
  if (toolName.startsWith('dataset_'))
    return <DataSetIcon className='shrink-0'></DataSetIcon>
  const icon = allToolIcons[toolName]
  if (!icon)
    return null
  return (
    typeof icon === 'string'
      ? (
        <div
          className='w-3 h-3 bg-cover bg-center rounded-[3px] shrink-0'
          style={{
            backgroundImage: `url(${icon})`,
          }}
        ></div>
      )
      : (
        <AppIcon
          className='rounded-[3px] shrink-0'
          size='xs'
          icon={icon?.content}
          background={icon?.background}
        />
      ))
}

const Tool: FC<Props> = ({
  payload,
  allToolIcons = {},
}) => {
  const { t } = useTranslation()
  const { name, label, input, isFinished, output } = payload
  const toolName = name.startsWith('dataset_') ? t('dataset.knowledge') : name
  const toolLabel = name.startsWith('dataset_') ? t('dataset.knowledge') : label
  const [isShowDetail, setIsShowDetail] = useState(false)
  const icon = getIcon(name, allToolIcons) as any
  return (
    <div>
      <div className={cn(!isShowDetail && 'shadow-sm', !isShowDetail && 'inline-block', 'max-w-full overflow-x-auto bg-white rounded-md')}>
        <div
          className={cn('flex items-center h-7 px-2 cursor-pointer')}
          onClick={() => setIsShowDetail(!isShowDetail)}
        >
          {!isFinished && (
            <RiLoader2Line className='w-3 h-3 text-gray-500 animate-spin shrink-0' />
          )}
          {isFinished && !isShowDetail && (
            <CheckCircle className='w-3 h-3 text-[#12B76A] shrink-0' />
          )}
          {isFinished && isShowDetail && (
            icon
          )}
          <span className='mx-1 text-xs font-medium text-gray-500 shrink-0'>
            {t(`tools.thought.${isFinished ? 'used' : 'using'}`)}
          </span>
          <span
            className='text-xs font-medium text-gray-700 truncate'
            title={toolLabel}
          >
            {toolLabel}
          </span>
          <RiArrowDownSLine
            className={cn(isShowDetail && 'rotate-180', 'ml-1 w-3 h-3 text-gray-500 select-none cursor-pointer shrink-0')}
          />
        </div>
        {isShowDetail && (
          <div className='border-t border-black/5 p-2 space-y-2 '>
            <Panel
              isRequest={true}
              toolName={toolName}
              content={input} />
            {output && (
              <Panel
                isRequest={false}
                toolName={toolName}
                content={output as string} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
export default React.memo(Tool)
