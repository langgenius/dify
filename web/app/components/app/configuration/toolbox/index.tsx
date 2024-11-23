'use client'

import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GroupName from '../base/group-name'
import Moderation from './moderation'
import Annotation from './annotation/config-param'
import type { EmbeddingModelConfig } from '@/app/components/app/annotation/type'

export type ToolboxProps = {
  showModerationSettings: boolean
  showAnnotation: boolean
  onEmbeddingChange: (embeddingModel: EmbeddingModelConfig) => void
  onScoreChange: (score: number, embeddingModel?: EmbeddingModelConfig) => void
}

const Toolbox: FC<ToolboxProps> = ({
  showModerationSettings,
  showAnnotation,
  onEmbeddingChange,
  onScoreChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mt-7'>
      <GroupName name={t('appDebug.feature.toolbox.title')} />
      {
        showModerationSettings && (
          <Moderation />
        )
      }
      {
        showAnnotation && (
          <Annotation
            onEmbeddingChange={onEmbeddingChange}
            onScoreChange={onScoreChange}
          />
        )
      }
    </div>
  )
}
export default React.memo(Toolbox)
