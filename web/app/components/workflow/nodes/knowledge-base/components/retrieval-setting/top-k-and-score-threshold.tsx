import { memo } from 'react'
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
}
const TopKAndScoreThreshold = ({
  topK,
  onTopKChange,
  scoreThreshold,
  onScoreThresholdChange,
  isScoreThresholdEnabled,
  onScoreThresholdEnabledChange,
  readonly,
}: TopKAndScoreThresholdProps) => {
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
          Top k
          <Tooltip
            triggerClassName='ml-0.5 shrink-0 w-3.5 h-3.5'
            popupContent='top k'
          />
        </div>
        <Input
          type='number'
          value={topK}
          onChange={handleTopKChange}
          disabled={readonly}
        />
      </div>
      <div>
        <div className='mb-0.5 flex h-6 items-center'>
          <Switch
            className='mr-2'
            defaultValue={isScoreThresholdEnabled}
            onChange={onScoreThresholdEnabledChange}
            disabled={readonly}
          />
          <div className='system-sm-medium grow truncate text-text-secondary'>
            Score Threshold
          </div>
          <Tooltip
            triggerClassName='shrink-0 ml-0.5 w-3.5 h-3.5'
            popupContent='Score Threshold'
          />
        </div>
        <Input
          type='number'
          value={scoreThreshold}
          onChange={handleScoreThresholdChange}
          disabled={readonly}
        />
      </div>
    </div>
  )
}

export default memo(TopKAndScoreThreshold)
