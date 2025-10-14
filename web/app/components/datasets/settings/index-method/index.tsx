'use client'
import { useTranslation } from 'react-i18next'
import { useRef } from 'react'
import { useHover } from 'ahooks'
import { IndexingType } from '../../create/step-two'
import classNames from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Economic, HighQuality } from '@/app/components/base/icons/src/vender/knowledge'
import { EffectColor } from '../chunk-structure/types'
import OptionCard from '../option-card'
import KeywordNumber from './keyword-number'

type IndexMethodProps = {
  value: IndexingType
  onChange: (id: IndexingType) => void
  disabled?: boolean
  currentValue?: IndexingType
  keywordNumber: number
  onKeywordNumberChange: (value: number) => void
}

const IndexMethod = ({
  value,
  onChange,
  disabled,
  currentValue,
  keywordNumber,
  onKeywordNumberChange,
}: IndexMethodProps) => {
  const { t } = useTranslation()
  const economyDomRef = useRef<HTMLDivElement>(null)
  const isHoveringEconomy = useHover(economyDomRef)
  const isEconomyDisabled = currentValue === IndexingType.QUALIFIED

  return (
    <div className={classNames('flex flex-col gap-y-2')}>
      {/* High Quality */}
      <OptionCard
        id={IndexingType.QUALIFIED}
        isActive={value === IndexingType.QUALIFIED}
        onClick={onChange}
        icon={<HighQuality className='size-[18px]' />}
        iconActiveColor='text-util-colors-orange-orange-500'
        title={t('datasetCreation.stepTwo.qualified')}
        description={t('datasetSettings.form.indexMethodHighQualityTip')}
        disabled={disabled}
        isRecommended
        effectColor={EffectColor.orange}
        showEffectColor
        className='gap-x-2'
      />
      {/* Economy */}
      <PortalToFollowElem
        open={isHoveringEconomy}
        offset={4}
        placement={'right'}
      >
        <PortalToFollowElemTrigger>
          <OptionCard
            ref={economyDomRef}
            id={IndexingType.ECONOMICAL}
            isActive={value === IndexingType.ECONOMICAL}
            onClick={onChange}
            icon={<Economic className='size-[18px]' />}
            iconActiveColor='text-util-colors-indigo-indigo-600'
            title={t('datasetSettings.form.indexMethodEconomy')}
            description={t('datasetSettings.form.indexMethodEconomyTip', { count: keywordNumber })}
            disabled={disabled || isEconomyDisabled}
            effectColor={EffectColor.indigo}
            showEffectColor
            showChildren
            className='gap-x-2'
          >
            <KeywordNumber
              keywordNumber={keywordNumber}
              onKeywordNumberChange={onKeywordNumberChange}
            />
          </OptionCard>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent style={{ zIndex: 60 }}>
          <div className='rounded-lg border-components-panel-border bg-components-tooltip-bg p-3 text-xs font-medium text-text-secondary shadow-lg'>
            {t('datasetSettings.form.indexMethodChangeToEconomyDisabledTip')}
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default IndexMethod
