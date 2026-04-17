import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@/app/components/base/ui/number-field'
import { Slider } from '@/app/components/base/ui/slider'

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

  const handleInputChange = useCallback((value: number | null) => {
    onKeywordNumberChange(value ?? MIN_KEYWORD_NUMBER)
  }, [onKeywordNumberChange])

  return (
    <div className="flex items-center gap-x-1">
      <div className="flex grow items-center gap-x-0.5">
        <div className="truncate system-xs-medium text-text-secondary">
          {t('form.numberOfKeywords', { ns: 'datasetSettings' })}
        </div>
        <Tooltip
          popupContent={t('form.numberOfKeywords', { ns: 'datasetSettings' })}
        >
          <span className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary" />
        </Tooltip>
      </div>
      <Slider
        className="mr-3 w-[206px] shrink-0"
        value={keywordNumber}
        min={MIN_KEYWORD_NUMBER}
        max={MAX_KEYWORD_NUMBER}
        onValueChange={onKeywordNumberChange}
        aria-label={t('form.numberOfKeywords', { ns: 'datasetSettings' })}
      />
      <NumberField
        className="w-12 shrink-0"
        min={MIN_KEYWORD_NUMBER}
        max={MAX_KEYWORD_NUMBER}
        value={keywordNumber}
        onValueChange={handleInputChange}
      >
        <NumberFieldGroup>
          <NumberFieldInput />
          <NumberFieldControls>
            <NumberFieldIncrement />
            <NumberFieldDecrement />
          </NumberFieldControls>
        </NumberFieldGroup>
      </NumberField>
    </div>
  )
}

export default React.memo(KeyWordNumber)
