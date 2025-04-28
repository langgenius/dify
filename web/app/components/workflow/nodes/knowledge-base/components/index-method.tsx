import { useState } from 'react'
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

const IndexMethod = () => {
  const { t } = useTranslation()
  const [method, setMethod] = useState('high_quality')

  return (
    <Field
      fieldTitleProps={{
        title: 'Index method',
      }}
    >
      <div className='space-y-1'>
        <OptionCard
          icon={
            <HighQuality
              className={cn(
                'h-[15px] w-[15px] text-text-tertiary',
                method === 'high_quality' && 'text-util-colors-orange-orange-500',
              )}
            />
          }
          title={t('datasetCreation.stepTwo.qualified')}
          description={t('datasetSettings.form.indexMethodHighQualityTip')}
          showHighlightBorder={method === 'high_quality'}
          onClick={() => setMethod('high_quality')}
          isRecommended
        ></OptionCard>
        <OptionCard
          icon={
            <Economic
              className={cn(
                'h-[15px] w-[15px] text-text-tertiary',
                method === 'economy' && 'text-util-colors-indigo-indigo-500',
              )}
            />
          }
          title={t('datasetSettings.form.indexMethodEconomy')}
          description={t('datasetSettings.form.indexMethodEconomyTip')}
          showChildren={method === 'economy'}
          showHighlightBorder={method === 'economy'}
          onClick={() => setMethod('economy')}
          effectColor='blue'
          showEffectColor={method === 'economy'}
        >
          <div className='flex items-center'>
            <div className='flex grow items-center'>
              <div className='system-xs-medium truncate text-text-secondary'>
                Number of Keywords
              </div>
              <Tooltip
                popupContent='number of keywords'
              >
                <RiQuestionLine className='ml-0.5 h-3.5 w-3.5 text-text-quaternary' />
              </Tooltip>
            </div>
            <Slider
              className='mr-3 w-24 shrink-0'
              value={0}
              onChange={() => {
                console.log('change')
              }}
            />
            <Input
              className='shrink-0'
              wrapperClassName='shrink-0 w-[72px]'
              type='number'
            />
          </div>
        </OptionCard>
      </div>
    </Field>
  )
}

export default IndexMethod
