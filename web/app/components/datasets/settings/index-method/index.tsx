'use client'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { Economic, HighQuality } from '@/app/components/base/icons/src/vender/knowledge'
import { IndexingType } from '../../create/step-two'
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
  const isEconomyDisabled = currentValue === IndexingType.QUALIFIED

  return (
    <div className={cn('flex flex-col gap-y-2')}>
      {/* High Quality */}
      <OptionCard
        id={IndexingType.QUALIFIED}
        isActive={value === IndexingType.QUALIFIED}
        onClick={onChange}
        icon={<HighQuality className="size-[18px]" />}
        iconActiveColor="text-util-colors-orange-orange-500"
        title={t('stepTwo.qualified', { ns: 'datasetCreation' })}
        description={t('form.indexMethodHighQualityTip', { ns: 'datasetSettings' })}
        disabled={disabled}
        isRecommended
        effectColor={EffectColor.orange}
        showEffectColor
        className="gap-x-2"
      />
      {/* Economy */}
      <Popover>
        <PopoverTrigger
          nativeButton={false}
          openOnHover={isEconomyDisabled}
          render={<div />}
        >
          <OptionCard
            id={IndexingType.ECONOMICAL}
            isActive={value === IndexingType.ECONOMICAL}
            onClick={onChange}
            icon={<Economic className="size-[18px]" />}
            iconActiveColor="text-util-colors-indigo-indigo-600"
            title={t('form.indexMethodEconomy', { ns: 'datasetSettings' })}
            description={t('form.indexMethodEconomyTip', { ns: 'datasetSettings', count: keywordNumber })}
            disabled={disabled || isEconomyDisabled}
            effectColor={EffectColor.indigo}
            showEffectColor
            showChildren
            className="gap-x-2"
          >
            <KeywordNumber
              keywordNumber={keywordNumber}
              onKeywordNumberChange={onKeywordNumberChange}
            />
          </OptionCard>
        </PopoverTrigger>
        {isEconomyDisabled && (
          <PopoverContent
            placement="right"
            sideOffset={4}
            popupClassName="rounded-lg border-0 bg-components-tooltip-bg p-3 text-xs font-medium text-text-secondary shadow-lg"
          >
            {t('form.indexMethodChangeToEconomyDisabledTip', { ns: 'datasetSettings' })}
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}

export default IndexMethod
