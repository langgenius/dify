'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import { RETRIEVE_METHOD } from '@/types/app'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip-plus'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
type Props = {
  type: RETRIEVE_METHOD
  value: any
  onChange: () => void
}

const RetrievalParamConfig: FC<Props> = ({
  type,
}) => {
  const { t } = useTranslation()
  const canToggleRerankModalEnable = type !== RETRIEVE_METHOD.hybrid
  const [isRerankModalEnable, setIsRerankModalEnable] = useState(false)
  const isScoreThresholdDisabled = type === RETRIEVE_METHOD.fullText && !isRerankModalEnable
  const isEconomical = type === RETRIEVE_METHOD.invertedIndex
  return (
    <div>
      {!isEconomical && (
        <div>
          <div className='flex h-8 items-center text-[13px] font-medium text-gray-900 space-x-2'>
            {canToggleRerankModalEnable && (
              <Switch
                size='md'
                defaultValue={isRerankModalEnable}
                onChange={setIsRerankModalEnable}
              />
            )}
            <div className='flex items-center'>
              <span className='mr-0.5'>{t('common.modelProvider.rerankModel.key')}</span>
              <Tooltip popupContent={<div className="w-[200px]">{'TODO'}</div>}>
                <HelpCircle className='w-[14px] h-[14px] text-gray-400' />
              </Tooltip>
            </div>
          </div>
          <div>Rerank Model 站位</div>
        </div>
      )}

      <div className={cn(!isEconomical && 'mt-4', 'flex space-between space-x-6')}>
        <TopKItem
          className='grow'
          value={2}
          onChange={() => {}}
          enable={true}
        />
        {!isScoreThresholdDisabled && !isEconomical && (
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
export default React.memo(RetrievalParamConfig)
