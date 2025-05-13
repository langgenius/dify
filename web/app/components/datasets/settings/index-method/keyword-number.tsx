import { InputNumber } from '@/app/components/base/input-number'
import Slider from '@/app/components/base/slider'
import Tooltip from '@/app/components/base/tooltip'
import { RiQuestionLine } from '@remixicon/react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type KeyWordNumberProps = {
  keywordNumber: number
  onKeywordNumberChange: (value: number) => void
}

const KeyWordNumber = ({
  keywordNumber,
  onKeywordNumberChange,
}: KeyWordNumberProps) => {
  const { t } = useTranslation()

  const handleInputChange = useCallback((value: number | undefined) => {
    if (value)
      onKeywordNumberChange(value)
  }, [onKeywordNumberChange])

  return (
    <div className='flex items-center gap-x-1'>
      <div className='flex grow items-center gap-x-0.5'>
        <div className='system-xs-medium truncate text-text-secondary'>
          {t('datasetSettings.form.numberOfKeywords')}
        </div>
        <Tooltip
          popupContent='number of keywords'
        >
          <RiQuestionLine className='h-3.5 w-3.5 text-text-quaternary' />
        </Tooltip>
      </div>
      <Slider
        className='mr-3 w-[206px] shrink-0'
        value={keywordNumber}
        max={50}
        onChange={onKeywordNumberChange}
      />
      <InputNumber
        wrapperClassName='shrink-0 w-12'
        type='number'
        value={keywordNumber}
        onChange={handleInputChange}
      />
    </div>
  )
}

export default React.memo(KeyWordNumber)
