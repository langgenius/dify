import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import cn from '@/utils/classnames'

type RetrievalSettingsProps = {
  topK: number
  scoreThreshold: number
  scoreThresholdEnabled: boolean
  isInHitTesting?: boolean
  isInRetrievalSetting?: boolean
  onChange: (data: { top_k?: number; score_threshold?: number; score_threshold_enabled?: boolean }) => void
}

const RetrievalSettings: FC<RetrievalSettingsProps> = ({
  topK,
  scoreThreshold,
  scoreThresholdEnabled,
  onChange,
  isInHitTesting = false,
  isInRetrievalSetting = false,
}) => {
  const { t } = useTranslation()

  const handleScoreThresholdChange = (enabled: boolean) => {
    onChange({ score_threshold_enabled: enabled })
  }

  return (
    <div className={cn('flex flex-col gap-2 self-stretch', isInRetrievalSetting && 'w-full max-w-[480px]')}>
      {!isInHitTesting && !isInRetrievalSetting && <div className='flex h-7 flex-col gap-2 self-stretch pt-1'>
        <label className='system-sm-semibold text-text-secondary'>{t('dataset.retrievalSettings')}</label>
      </div>}
      <div className={cn(
        'flex gap-4 self-stretch',
        {
          'flex-col': isInHitTesting,
          'flex-row': isInRetrievalSetting,
          'flex-col sm:flex-row': !isInHitTesting && !isInRetrievalSetting,
        },
      )}>
        <div className='flex grow flex-col gap-1'>
          <TopKItem
            className='grow'
            value={topK}
            onChange={(_key, v) => onChange({ top_k: v })}
            enable={true}
          />
        </div>
        <div className='flex grow flex-col gap-1'>
          <ScoreThresholdItem
            className='grow'
            value={scoreThreshold}
            onChange={(_key, v) => onChange({ score_threshold: v })}
            enable={scoreThresholdEnabled}
            hasSwitch={true}
            onSwitchChange={(_key, v) => handleScoreThresholdChange(v)}
          />
        </div>
      </div>
    </div>
  )
}

export default RetrievalSettings
