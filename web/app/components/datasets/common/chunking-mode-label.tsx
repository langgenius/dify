'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'

type Props = Readonly<{
  isGeneralMode: boolean
  isQAMode: boolean
}>

const ChunkingModeLabel: FC<Props> = ({ isGeneralMode, isQAMode }) => {
  const { t } = useTranslation()
  const iconClassName = isGeneralMode
    ? 'i-custom-vender-knowledge-general-chunk'
    : 'i-custom-vender-knowledge-parent-child-chunk'
  const generalSuffix = isQAMode ? ' · QA' : ''

  return (
    <Badge>
      <div className="flex h-full items-center space-x-0.5 text-text-tertiary">
        <span aria-hidden className={cn(iconClassName, 'size-3')} />
        <span className="system-2xs-medium-uppercase">
          {isGeneralMode
            ? `${t(($) => $['chunkingMode.general'], { ns: 'dataset' })}${generalSuffix}`
            : t(($) => $['chunkingMode.parentChild'], { ns: 'dataset' })}
        </span>
      </div>
    </Badge>
  )
}
export default React.memo(ChunkingModeLabel)
