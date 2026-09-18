import { cn } from '@langgenius/dify-ui/cn'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderLabel,
  SliderThumb,
  SliderTrack,
} from '@langgenius/dify-ui/slider'
import { memo, useCallback, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Economic, HighQuality } from '@/app/components/base/icons/src/vender/knowledge'
import { Infotip } from '@/app/components/base/infotip'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import { ChunkStructureEnum, IndexMethodEnum } from '../types'
import OptionCard from './option-card'

type IndexMethodProps = {
  chunkStructure: ChunkStructureEnum
  indexMethod?: IndexMethodEnum
  onIndexMethodChange: (value: IndexMethodEnum) => void
  keywordNumber: number
  onKeywordNumberChange: (value: number) => void
  readonly?: boolean
}
const IndexMethod = ({
  chunkStructure,
  indexMethod,
  onIndexMethodChange,
  keywordNumber,
  onKeywordNumberChange,
  readonly = false,
}: IndexMethodProps) => {
  const { t } = useTranslation()
  const keywordInputId = useId()
  const keywordNumberLabel = t(($) => $['form.numberOfKeywords'], { ns: 'datasetSettings' })
  const isHighQuality = indexMethod === IndexMethodEnum.QUALIFIED
  const isEconomy = indexMethod === IndexMethodEnum.ECONOMICAL

  const handleIndexMethodChange = useCallback(
    (newIndexMethod: IndexMethodEnum) => {
      onIndexMethodChange(newIndexMethod)
    },
    [onIndexMethodChange],
  )

  const handleInputChange = useCallback(
    (value: number | null) => {
      if (value !== null) onKeywordNumberChange(value)
    },
    [onKeywordNumberChange],
  )

  return (
    <Field
      fieldTitleProps={{
        title: t(($) => $['stepTwo.indexMode'], { ns: 'datasetCreation' }),
      }}
    >
      <div className="space-y-1">
        <OptionCard<IndexMethodEnum>
          id={IndexMethodEnum.QUALIFIED}
          selectedId={indexMethod}
          icon={
            <HighQuality
              className={cn(
                'h-3.75 w-3.75 text-text-tertiary group-hover:text-util-colors-orange-orange-500',
                isHighQuality && 'text-util-colors-orange-orange-500',
              )}
            />
          }
          title={t(($) => $['stepTwo.qualified'], { ns: 'datasetCreation' })}
          description={t(($) => $['form.indexMethodHighQualityTip'], { ns: 'datasetSettings' })}
          onClick={handleIndexMethodChange}
          isRecommended
          effectColor="orange"
        ></OptionCard>
        {chunkStructure === ChunkStructureEnum.general && (
          <OptionCard
            id={IndexMethodEnum.ECONOMICAL}
            selectedId={indexMethod}
            icon={
              <Economic
                className={cn(
                  'h-3.75 w-3.75 text-text-tertiary group-hover:text-util-colors-indigo-indigo-500',
                  isEconomy && 'text-util-colors-indigo-indigo-500',
                )}
              />
            }
            title={t(($) => $['form.indexMethodEconomy'], { ns: 'datasetSettings' })}
            description={t(($) => $['form.indexMethodEconomyTip'], {
              ns: 'datasetSettings',
              count: keywordNumber,
            })}
            onClick={handleIndexMethodChange}
            effectColor="blue"
          >
            <Fieldset className="flex items-center">
              <FieldsetLegend className="sr-only">{keywordNumberLabel}</FieldsetLegend>
              <div className="flex grow items-center">
                <label
                  htmlFor={keywordInputId}
                  className="truncate system-xs-medium text-text-secondary"
                >
                  {keywordNumberLabel}
                </label>
                <Infotip aria-label={keywordNumberLabel} className="ml-0.5 size-3.5">
                  {keywordNumberLabel}
                </Infotip>
              </div>
              <Slider
                disabled={readonly}
                className="mr-3 w-24 shrink-0"
                value={keywordNumber}
                onValueChange={onKeywordNumberChange}
              >
                <SliderLabel className="sr-only">{keywordNumberLabel}</SliderLabel>
                <SliderControl>
                  <SliderTrack>
                    <SliderIndicator />
                    <SliderThumb />
                  </SliderTrack>
                </SliderControl>
              </Slider>
              <NumberField
                id={keywordInputId}
                disabled={readonly}
                className="w-18 shrink-0"
                min={0}
                format={{ maximumFractionDigits: 0 }}
                value={keywordNumber}
                onValueChange={handleInputChange}
              >
                <NumberFieldGroup>
                  <NumberFieldInput className="px-2" />
                  <NumberFieldControls>
                    <NumberFieldIncrement />
                    <NumberFieldDecrement />
                  </NumberFieldControls>
                </NumberFieldGroup>
              </NumberField>
            </Fieldset>
          </OptionCard>
        )}
      </div>
    </Field>
  )
}

export default memo(IndexMethod)
