import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiQuestionLine } from '@remixicon/react'
import {
  Economic,
  HighQuality,
} from '@/app/components/base/icons/src/vender/knowledge'
import Tooltip from '@/app/components/base/tooltip'
import Slider from '@/app/components/base/slider'
import Input from '@/app/components/base/input'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import OptionCard from './option-card'
import cn from '@/utils/classnames'
import {
  ChunkStructureEnum,
  IndexMethodEnum,
} from '../types'

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
  const isHighQuality = indexMethod === IndexMethodEnum.QUALIFIED
  const isEconomy = indexMethod === IndexMethodEnum.ECONOMICAL

  const handleIndexMethodChange = useCallback((newIndexMethod: IndexMethodEnum) => {
    onIndexMethodChange(newIndexMethod)
  }, [onIndexMethodChange])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    if (!Number.isNaN(value))
      onKeywordNumberChange(value)
  }, [onKeywordNumberChange])

  return (
    <Field
      fieldTitleProps={{
        title: t('datasetCreation.stepTwo.indexMode'),
      }}
    >
      <div className='space-y-1'>
        <OptionCard<IndexMethodEnum>
          id={IndexMethodEnum.QUALIFIED}
          selectedId={indexMethod}
          icon={
            <HighQuality
              className={cn(
                'h-[15px] w-[15px] text-text-tertiary group-hover:text-util-colors-orange-orange-500',
                isHighQuality && 'text-util-colors-orange-orange-500',
              )}
            />
          }
          title={t('datasetCreation.stepTwo.qualified')}
          description={t('datasetSettings.form.indexMethodHighQualityTip')}
          onClick={handleIndexMethodChange}
          isRecommended
          effectColor='orange'
        ></OptionCard>
        {
          chunkStructure === ChunkStructureEnum.general && (
            <OptionCard
              id={IndexMethodEnum.ECONOMICAL}
              selectedId={indexMethod}
              icon={
                <Economic
                  className={cn(
                    'h-[15px] w-[15px] text-text-tertiary group-hover:text-util-colors-indigo-indigo-500',
                    isEconomy && 'text-util-colors-indigo-indigo-500',
                  )}
                />
              }
              title={t('datasetSettings.form.indexMethodEconomy')}
              description={t('datasetSettings.form.indexMethodEconomyTip', { count: keywordNumber })}
              onClick={handleIndexMethodChange}
              effectColor='blue'
            >
              <div className='flex items-center'>
                <div className='flex grow items-center'>
                  <div className='system-xs-medium truncate text-text-secondary'>
                    {t('datasetSettings.form.numberOfKeywords')}
                  </div>
                  <Tooltip
                    popupContent='number of keywords'
                  >
                    <RiQuestionLine className='ml-0.5 h-3.5 w-3.5 text-text-quaternary' />
                  </Tooltip>
                </div>
                <Slider
                  disabled={readonly}
                  className='mr-3 w-24 shrink-0'
                  value={keywordNumber}
                  onChange={onKeywordNumberChange}
                />
                <Input
                  disabled={readonly}
                  className='shrink-0'
                  wrapperClassName='shrink-0 w-[72px]'
                  type='number'
                  value={keywordNumber}
                  onChange={handleInputChange}
                />
              </div>
            </OptionCard>
          )
        }
      </div>
    </Field>
  )
}

export default memo(IndexMethod)
