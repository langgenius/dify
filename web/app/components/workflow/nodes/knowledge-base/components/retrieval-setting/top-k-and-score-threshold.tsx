import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import Input from '@/app/components/base/input'
import Switch from '@/app/components/base/switch'

export type TopKAndScoreThresholdProps = {
  topK: number
  onTopKChange: (value: number) => void
  scoreThreshold?: number
  onScoreThresholdChange?: (value: number) => void
  isScoreThresholdEnabled?: boolean
  onScoreThresholdEnabledChange?: (value: boolean) => void
  readonly?: boolean
  hiddenScoreThreshold?: boolean
}
const TopKAndScoreThreshold = ({
  topK,
  onTopKChange,
  scoreThreshold,
  onScoreThresholdChange,
  isScoreThresholdEnabled,
  onScoreThresholdEnabledChange,
  readonly,
  hiddenScoreThreshold,
}: TopKAndScoreThresholdProps) => {
  const { t } = useTranslation()
  const handleTopKChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    if (Number.isNaN(value))
      return
    onTopKChange?.(value)
  }

  const handleScoreThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    if (Number.isNaN(value))
      return
    onScoreThresholdChange?.(value)
  }

  return (
    <div className='grid grid-cols-2 gap-4'>
      <div>
        <div className='system-xs-medium mb-0.5 flex h-6 items-center text-text-secondary'>
          {t('appDebug.datasetConfig.top_k')}
          <Tooltip
            triggerClassName='ml-0.5 shrink-0 w-3.5 h-3.5'
            popupContent={t('appDebug.datasetConfig.top_kTip')}
          />
        </div>
        <Input
          type='number'
          value={topK}
          onChange={handleTopKChange}
          disabled={readonly}
        />
      </div>
      {
        !hiddenScoreThreshold && (
          <div>
            <div className='mb-0.5 flex h-6 items-center'>
              <Switch
                className='mr-2'
                defaultValue={isScoreThresholdEnabled}
                onChange={onScoreThresholdEnabledChange}
                disabled={readonly}
              />
              <div className='system-sm-medium grow truncate text-text-secondary'>
                {t('appDebug.datasetConfig.score_threshold')}
              </div>
              <Tooltip
                triggerClassName='shrink-0 ml-0.5 w-3.5 h-3.5'
                popupContent={t('appDebug.datasetConfig.score_thresholdTip')}
              />
            </div>
            <Input
              type='number'
              value={scoreThreshold}
              onChange={handleScoreThresholdChange}
              disabled={readonly || !isScoreThresholdEnabled}
            />
          </div>
        )
      }
    </div>
  )
}

export default memo(TopKAndScoreThreshold)
