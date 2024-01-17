'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import cn from 'classnames'
import type { ToolThought } from '../type'
import Panel from './panel'
import { Loading02 } from '@/app/components/base/icons/src/vender/line/general'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import { CheckCircle } from '@/app/components/base/icons/src/vender/solid/general'
import { DataSet as DataSetIcon } from '@/app/components/base/icons/src/public/thought'
import type { Emoji } from '@/app/components/tools/types'
import AppIcon from '@/app/components/base/app-icon'

type Props = {
  payload: ToolThought
  allToolIcons?: Record<string, string | Emoji>
}

const getIcon = (toolName: string, allToolIcons: Record<string, string | Emoji>) => {
  if (toolName.startsWith('dataset-'))
    return <DataSetIcon ></DataSetIcon>
  const icon = allToolIcons[toolName]
  if (!icon)
    return null
  return (
    typeof icon === 'string'
      ? (
        <div
          className='w-3 h-3 bg-cover bg-center rounded-[3px]'
          style={{
            backgroundImage: `url(${icon})`,
          }}
        ></div>
      )
      : (
        <AppIcon
          className='rounded-[3px]'
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

  const toolName = payload.input.tool
  const input = payload.input
  const isFinished = !!payload.output
  const output = payload.output
  const [isShowDetail, setIsShowDetail] = useState(false)
  const icon = getIcon(toolName, allToolIcons) as any
  return (
    <div>
      <div className={cn(!isShowDetail && 'shadow-sm', !isShowDetail && 'inline-block', 'max-w-full overflow-x-auto bg-white rounded-md')}>
        <div
          className={cn('flex items-center h-7 px-2 justify-between cursor-pointer')}
          onClick={() => setIsShowDetail(!isShowDetail)}
        >
          <div
            className='flex items-center '
          >
            {!isFinished && (
              <Loading02 className='w-3 h-3 text-gray-500 animate-spin' />
            )}
            {isFinished && !isShowDetail && (
              <CheckCircle className='w-3 h-3 text-[#12B76A]' />
            )}
            {isFinished && isShowDetail && (
              icon
            )}
            <div className='ml-1 text-xs font-medium text-gray-700'>
              <span className=' text-gray-500'>
                {t(`tools.thought.${isFinished ? 'used' : 'using'}`)}
              </span>
              &nbsp;{toolName}
            </div>
          </div>
          <ChevronDown
            className={cn(isShowDetail && 'rotate-180', 'ml-1 w-3 h-3 text-gray-500 select-none cursor-pointer')}
          />
        </div>
        {isShowDetail && (
          <div className='border-t border-black/5 p-2 space-y-2 '>
            <Panel
              isRequest={true}
              toolName={toolName}
              content={input.tool_input} />
            {isFinished && (
              <Panel
                isRequest={false}
                toolName={toolName}
                content={output?.observation as string} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
export default React.memo(Tool)
