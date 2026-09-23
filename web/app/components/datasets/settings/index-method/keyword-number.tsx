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
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const MIN_KEYWORD_NUMBER = 0
const MAX_KEYWORD_NUMBER = 50

type KeyWordNumberProps = {
  disabled?: boolean
  keywordNumber: number
  onKeywordNumberChange: (value: number) => void
}

const KeyWordNumber = ({ disabled, keywordNumber, onKeywordNumberChange }: KeyWordNumberProps) => {
  const { t } = useTranslation()
  const label = t(($) => $['form.numberOfKeywords'], { ns: 'datasetSettings' })

  const handleInputChange = useCallback(
    (value: number | null) => {
      onKeywordNumberChange(value ?? MIN_KEYWORD_NUMBER)
    },
    [onKeywordNumberChange],
  )

  return (
    <Fieldset className="flex items-center gap-x-1">
      <FieldsetLegend className="sr-only">{label}</FieldsetLegend>
      <div className="flex grow items-center gap-x-0.5">
        <div className="truncate system-xs-medium text-text-secondary">{label}</div>
      </div>
      <Slider
        disabled={disabled}
        className="mr-3 w-51.5 shrink-0"
        value={keywordNumber}
        min={MIN_KEYWORD_NUMBER}
        max={MAX_KEYWORD_NUMBER}
        onValueChange={onKeywordNumberChange}
      >
        <SliderLabel className="sr-only">{label}</SliderLabel>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb />
          </SliderTrack>
        </SliderControl>
      </Slider>
      <NumberField
        disabled={disabled}
        className="w-18.5 shrink-0"
        min={MIN_KEYWORD_NUMBER}
        max={MAX_KEYWORD_NUMBER}
        value={keywordNumber}
        onValueChange={handleInputChange}
      >
        <NumberFieldGroup>
          <NumberFieldInput aria-label={label} className="w-12 flex-none px-2 text-center" />
          <NumberFieldControls>
            <NumberFieldIncrement />
            <NumberFieldDecrement />
          </NumberFieldControls>
        </NumberFieldGroup>
      </NumberField>
    </Fieldset>
  )
}

export default React.memo(KeyWordNumber)
