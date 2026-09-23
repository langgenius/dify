'use client'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useTranslation } from 'react-i18next'
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
    <RadioGroup<IndexingType>
      aria-label={t(($) => $['form.indexMethod'], { ns: 'datasetSettings' })}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      className="flex flex-col items-stretch gap-x-0 gap-y-2"
    >
      {/* High Quality */}
      <OptionCard
        id={IndexingType.QUALIFIED}
        isActive={value === IndexingType.QUALIFIED}
        icon={<span aria-hidden className="i-custom-vender-knowledge-high-quality size-4.5" />}
        iconActiveColor="text-util-colors-orange-orange-500"
        title={t(($) => $['stepTwo.qualified'], { ns: 'datasetCreation' })}
        description={t(($) => $['form.indexMethodHighQualityTip'], { ns: 'datasetSettings' })}
        disabled={disabled}
        isRecommended
        effectColor={EffectColor.orange}
        showEffectColor
        className="gap-x-2"
      />
      {/* Economy */}
      <Popover>
        <PopoverTrigger nativeButton={false} openOnHover={isEconomyDisabled} render={<div />}>
          <OptionCard
            id={IndexingType.ECONOMICAL}
            isActive={value === IndexingType.ECONOMICAL}
            icon={<span aria-hidden className="i-custom-vender-knowledge-economic size-4.5" />}
            iconActiveColor="text-util-colors-indigo-indigo-600"
            title={t(($) => $['form.indexMethodEconomy'], { ns: 'datasetSettings' })}
            description={t(($) => $['form.indexMethodEconomyTip'], {
              ns: 'datasetSettings',
              count: keywordNumber,
            })}
            disabled={disabled || isEconomyDisabled}
            effectColor={EffectColor.indigo}
            showEffectColor
            showChildren={value === IndexingType.ECONOMICAL}
            className="gap-x-2"
          >
            <KeywordNumber
              disabled={disabled || isEconomyDisabled}
              keywordNumber={keywordNumber}
              onKeywordNumberChange={onKeywordNumberChange}
            />
          </OptionCard>
        </PopoverTrigger>
        {isEconomyDisabled && (
          <PopoverContent
            placement="right"
            sideOffset={4}
            className="rounded-lg border-0 bg-components-tooltip-bg p-3 text-xs font-medium text-text-secondary shadow-lg"
          >
            {t(($) => $['form.indexMethodChangeToEconomyDisabledTip'], { ns: 'datasetSettings' })}
          </PopoverContent>
        )}
      </Popover>
    </RadioGroup>
  )
}

export default IndexMethod
