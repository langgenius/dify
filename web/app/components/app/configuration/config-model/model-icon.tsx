'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import {
  OpenaiGreen,
  OpenaiViolet,
} from '@/app/components/base/icons/src/public/llm'
import { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import ProviderConfig from '@/app/components/header/account-setting/model-page/configs'

export type IModelIconProps = {
  modelId: string
  providerName: ProviderEnum
  className?: string
}

const ModelIcon: FC<IModelIconProps> = ({ modelId, providerName, className }) => {
  let Icon = <OpenaiGreen className='w-full h-full' />
  if (providerName === ProviderEnum.openai)
    Icon = modelId.includes('gpt-4') ? <OpenaiViolet className='w-full h-full' /> : <OpenaiGreen className='w-full h-full' />
  else
    Icon = ProviderConfig[providerName]?.selector.icon

  return (
    <div className={cn(className, 'w-4 h-4')}>
      {Icon}
    </div>
  )
}

export default React.memo(ModelIcon)
