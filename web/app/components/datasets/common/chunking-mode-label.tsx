'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { GeneralType, ParentChildType } from '@/app/components/base/icons/src/public/knowledge'

type Props = {
  isGeneralMode: boolean
  isQAMode: boolean
}

const ChunkingModeLabel: FC<Props> = ({
  isGeneralMode,
  isQAMode,
}) => {
  const { t } = useTranslation()
  const TypeIcon = isGeneralMode ? GeneralType : ParentChildType

  return (
    <Badge>
      <div className='text-text-tertiary flex h-full items-center space-x-0.5'>
        <TypeIcon className='h-3 w-3' />
        <span className='system-2xs-medium-uppercase'>{isGeneralMode ? `${t('dataset.chunkingMode.general')}${isQAMode ? ' · QA' : ''}` : t('dataset.chunkingMode.parentChild')}</span>
      </div>
    </Badge>
  )
}
export default React.memo(ChunkingModeLabel)
