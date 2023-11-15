'use client'
import type { FC } from 'react'
import React from 'react'

export type IModelNameProps = {
  modelId: string
  modelDisplayName?: string
}

export const supportI18nModelName = [
  'gpt-3.5-turbo', 'gpt-3.5-turbo-16k',
  'gpt-4', 'gpt-4-32k',
  'text-davinci-003', 'text-embedding-ada-002', 'whisper-1',
  'claude-instant-1', 'claude-2',
]

const ModelName: FC<IModelNameProps> = ({
  modelDisplayName,
}) => {
  return (
    <span className='text-ellipsis overflow-hidden whitespace-nowrap' title={modelDisplayName}>
      {modelDisplayName}
    </span>
  )
}
export default React.memo(ModelName)
