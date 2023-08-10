'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import {
  Anthropic,
  Chatglm,
  Huggingface,
  IflytekSpark,
  OpenaiBlue,
  OpenaiGreen,
  OpenaiViolet,
  Replicate,
} from '@/app/components/base/icons/src/public/llm'
import {
  Minimax,
  Tongyi,
} from '@/app/components/base/icons/src/image/llm'
import { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'

export type IModelIconProps = {
  modelId: string
  providerName: ProviderEnum
  className?: string
}
const icons: any = {
  [ProviderEnum.azure_openai]: OpenaiBlue,
  [ProviderEnum.anthropic]: Anthropic,
  [ProviderEnum.replicate]: Replicate,
  [ProviderEnum.huggingface_hub]: Huggingface,
  [ProviderEnum.minimax]: Minimax,
  [ProviderEnum.spark]: IflytekSpark,
  [ProviderEnum.tongyi]: Tongyi,
  [ProviderEnum.chatglm]: Chatglm,
}

const ModelIcon: FC<IModelIconProps> = ({ modelId, providerName, className }) => {
  let Icon = OpenaiGreen
  if (providerName === ProviderEnum.openai)
    Icon = modelId.includes('gpt-4') ? OpenaiViolet : OpenaiGreen
  if (icons[providerName])
    Icon = icons[providerName]
  return <Icon className={cn(className, 'w-4 h-4')} />
}

export default React.memo(ModelIcon)
