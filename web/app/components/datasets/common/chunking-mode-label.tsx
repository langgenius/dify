'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { GeneralChunk, ParentChildChunk } from '@/app/components/base/icons/src/vender/knowledge'

type Props = {
  isGeneralMode: boolean
  isQAMode: boolean
}

const ChunkingModeLabel: FC<Props> = ({
  isGeneralMode,
  isQAMode,
}) => {
  const { t } = useTranslation()
  const TypeIcon = isGeneralMode ? GeneralChunk : ParentChildChunk
  const generalSuffix = isQAMode ? ' · QA' : ''

  return (
    <Badge>
      <div className='flex h-full items-center space-x-0.5 text-text-tertiary'>
        <TypeIcon className='h-3 w-3' />
        <span className='system-2xs-medium-uppercase'>{isGeneralMode ? `${t('dataset.chunkingMode.general')}${generalSuffix}` : t('dataset.chunkingMode.parentChild')}</span>
      </div>
    </Badge>
  )
}
export default React.memo(ChunkingModeLabel)
