'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import { RETRIEVE_METHOD } from '@/types/app'

type Props = {
  type: RETRIEVE_METHOD
  value: any
  onChange: () => void
}

const RetrivalParamConfig: FC<Props> = ({
  type,
}) => {
  const { t } = useTranslation()
  const canToggleRerankModalEnable = type !== RETRIEVE_METHOD.hybrid
  const isRerankModalEnable = true
  const isScoreThresholdDisabled = type === RETRIEVE_METHOD.fullText && !isRerankModalEnable
  return (
    <div>
      <div>
        <div className='leading-[32px] text-[13px] font-medium text-gray-900'>
          {canToggleRerankModalEnable ? '有开关' : ''}
          {t('common.modelProvider.rerankModel.key')}
        </div>
        <div>Rerank Model 站位</div>
      </div>
      <div className='flex mt-4 space-between space-x-6'>
        <TopKItem
          className='grow'
          value={2}
          onChange={() => {}}
          enable={true}
        />
        {!isScoreThresholdDisabled && (
          <ScoreThresholdItem
            className='grow'
            value={1}
            onChange={() => {}}
            enable={true}
            hasSwitch={true}
            onSwitchChange={() => {}}
          />
        )}
      </div>
    </div>
  )
}
export default React.memo(RetrivalParamConfig)
