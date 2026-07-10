import { FieldsetLegend, FieldsetRoot } from '@langgenius/dify-ui/fieldset'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import { Slider } from '@langgenius/dify-ui/slider'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'

const MIN_KEYWORD_NUMBER = 0
const MAX_KEYWORD_NUMBER = 50

type KeyWordNumberProps = {
  keywordNumber: number
  onKeywordNumberChange: (value: number) => void
}

const KeyWordNumber = ({
  keywordNumber,
  onKeywordNumberChange,
}: KeyWordNumberProps) => {
  const { t } = useTranslation()
  const label = t($ => $['form.numberOfKeywords'], { ns: 'datasetSettings' })

  const handleInputChange = useCallback((value: number | null) => {
    onKeywordNumberChange(value ?? MIN_KEYWORD_NUMBER)
  }, [onKeywordNumberChange])

  return (
    <FieldsetRoot className="flex items-center gap-x-1">
      <FieldsetLegend className="sr-only">{label}</FieldsetLegend>
      <div className="flex grow items-center gap-x-0.5">
        <div className="truncate system-xs-medium text-text-secondary">
          {label}
        </div>
        <Infotip
          aria-label={label}
          className="size-3.5"
        >
          {label}
        </Infotip>
      </div>
      <Slider
        className="mr-3 w-[206px] shrink-0"
        value={keywordNumber}
        min={MIN_KEYWORD_NUMBER}
        max={MAX_KEYWORD_NUMBER}
        onValueChange={onKeywordNumberChange}
        aria-label={label}
      />
      <NumberField
        className="w-[74px] shrink-0"
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
    </FieldsetRoot>
  )
}

export default React.memo(KeyWordNumber)
