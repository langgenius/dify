'use client'
import type { FC } from 'react'
import React from 'react'
import { ProviderType } from '@/types/app'
import { MODEL_LIST } from '@/config'
import { Anthropic, Gpt3, Gpt4 } from '@/app/components/base/icons/src/public/llm'

export type IModelIconProps = { modelId: string; className?: string }

const ModelIcon: FC<IModelIconProps> = ({ modelId, className }) => {
  const resClassName = `w-4 h-4 ${className}`
  const model = MODEL_LIST.find(item => item.id === modelId)
  if (model?.id === 'gpt-4')
    return <Gpt4 className={resClassName} />

  if (model?.provider === ProviderType.anthropic) {
    return (
      <Anthropic className={resClassName} />
    )
  }
  return (
    <Gpt3 className={resClassName} />
  )
}

export default React.memo(ModelIcon)
