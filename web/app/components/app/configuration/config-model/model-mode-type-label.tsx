'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { ModelModeType } from '@/types/app'

type Props = {
  className?: string
  type: ModelModeType
  isHighlight?: boolean
}

const ModelModeTypeLabel: FC<Props> = ({
  className,
  type,
  isHighlight,
}) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(className, isHighlight ? 'border-indigo-300 text-indigo-600' : 'border-gray-300 text-gray-500', 'flex items-center h-4 px-1 border  rounded text-xs font-semibold uppercase')}
    >
      {t(`appDebug.modelConfig.modeType.${type}`)}
    </div>
  )
}
export default React.memo(ModelModeTypeLabel)
