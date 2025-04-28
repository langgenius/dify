import { useTranslation } from 'react-i18next'
import { RiQuestionLine } from '@remixicon/react'
import {
  Economic,
  HighQuality,
} from '@/app/components/base/icons/src/vender/knowledge'
import Tooltip from '@/app/components/base/tooltip'
import Slider from '@/app/components/base/slider'
import Input from '@/app/components/base/input'
import OptionCard from './option-card'

const IndexMethod = () => {
  const { t } = useTranslation()

  return (
    <div>
      <div className='system-sm-semibold-uppercase mb-0.5 flex h-6 items-center text-text-secondary'>Index method</div>
      <div className='space-y-1'>
        <OptionCard
          icon={<HighQuality className='h-[15px] w-[15px] text-util-colors-orange-orange-500' />}
          title={t('datasetCreation.stepTwo.qualified')}
          description={t('datasetSettings.form.indexMethodHighQualityTip')}
          showHighlightBorder
        ></OptionCard>
        <OptionCard
          icon={<Economic className='h-[15px] w-[15px] text-text-tertiary' />}
          title={t('datasetSettings.form.indexMethodEconomy')}
          description={t('datasetSettings.form.indexMethodEconomyTip')}
          showChildren
          showHighlightBorder
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
    </div>
  )
}

export default IndexMethod
