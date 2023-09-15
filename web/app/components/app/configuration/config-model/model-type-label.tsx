'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelType } from '@/types/app'

type Props = {
  type: ModelType
}

const ModelTypeLabel: FC<Props> = ({
  type,
}) => {
  const { t } = useTranslation()

  return (
    <div
      className='flex items-center h-4 px-1 border border-indigo-300 rounded text-indigo-600 text-xs font-semibold uppercase'
      style={{ backgroundColor: 'rgba(255, 255, 255, 0.30)' }}
    >
      {t(`appDebug.modelConfig.modeType.${type}`)}
    </div>
  )
}
export default React.memo(ModelTypeLabel)
