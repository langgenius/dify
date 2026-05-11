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

  const handleInputChange = useCallback((value: number | null) => {
    onKeywordNumberChange(value ?? MIN_KEYWORD_NUMBER)
  }, [onKeywordNumberChange])

  return (
    <div className="flex items-center gap-x-1">
      <div className="flex grow items-center gap-x-0.5">
        <div className="truncate system-xs-medium text-text-secondary">
          {t('form.numberOfKeywords', { ns: 'datasetSettings' })}
        </div>
        <Infotip
          aria-label={t('form.numberOfKeywords', { ns: 'datasetSettings' })}
          className="h-3.5 w-3.5"
        >
          {t('form.numberOfKeywords', { ns: 'datasetSettings' })}
        </Infotip>
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
        className="w-[74px] shrink-0"
        min={MIN_KEYWORD_NUMBER}
        max={MAX_KEYWORD_NUMBER}
        value={keywordNumber}
        onValueChange={handleInputChange}
      >
        <NumberFieldGroup>
          <NumberFieldInput className="w-12 flex-none px-2 text-center" />
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
