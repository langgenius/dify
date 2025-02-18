import { useState } from 'react'
import {
  RiCloseLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import RetrievalSettings from '../external-knowledge-base/create/RetrievalSettings'
import Button from '@/app/components/base/button'
import ActionButton from '@/app/components/base/action-button'

type ModifyExternalRetrievalModalProps = {
  onClose: () => void
  onSave: (data: { top_k: number; score_threshold: number; score_threshold_enabled: boolean }) => void
  initialTopK: number
  initialScoreThreshold: number
  initialScoreThresholdEnabled: boolean
}

const ModifyExternalRetrievalModal: React.FC<ModifyExternalRetrievalModalProps> = ({
  onClose,
  onSave,
  initialTopK,
  initialScoreThreshold,
  initialScoreThresholdEnabled,
}) => {
  const { t } = useTranslation()
  const [topK, setTopK] = useState(initialTopK)
  const [scoreThreshold, setScoreThreshold] = useState(initialScoreThreshold)
  const [scoreThresholdEnabled, setScoreThresholdEnabled] = useState(initialScoreThresholdEnabled)

  const handleSettingsChange = (data: { top_k?: number; score_threshold?: number; score_threshold_enabled?: boolean }) => {
    if (data.top_k !== undefined)
      setTopK(data.top_k)
    if (data.score_threshold !== undefined)
      setScoreThreshold(data.score_threshold)
    if (data.score_threshold_enabled !== undefined)
      setScoreThresholdEnabled(data.score_threshold_enabled)
  }

  const handleSave = () => {
    onSave({ top_k: topK, score_threshold: scoreThreshold, score_threshold_enabled: scoreThresholdEnabled })
    onClose()
  }

  return (
    <div className='border-components-panel-border bg-components-panel-bg shadows-shadow-2xl absolute right-[14px] top-[36px] z-10 flex w-[320px] flex-col
      items-start rounded-2xl border-[0.5px]'
    >
      <div className='flex items-center justify-between self-stretch p-4 pb-2'>
        <div className='text-text-primary system-xl-semibold grow'>{t('datasetHitTesting.settingTitle')}</div>
        <ActionButton className='ml-auto' onClick={onClose}>
          <RiCloseLine className='h-4 w-4 shrink-0' />
        </ActionButton>
      </div>
      <div className='flex flex-col items-start justify-center gap-4 self-stretch p-4 pt-2'>
        <RetrievalSettings
          topK={topK}
          scoreThreshold={scoreThreshold}
          scoreThresholdEnabled={scoreThresholdEnabled}
          onChange={handleSettingsChange}
          isInHitTesting={true}
        />
      </div>
      <div className='flex w-full items-end justify-end gap-1 p-4 pt-2'>
        <Button className='min-w-[72px] shrink-0' onClick={onClose}>{t('common.operation.cancel')}</Button>
        <Button variant='primary' className='min-w-[72px] shrink-0' onClick={handleSave}>{t('common.operation.save')}</Button>
      </div>
    </div>
  )
}

export default ModifyExternalRetrievalModal
