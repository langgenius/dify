import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiLoginCircleLine } from '@remixicon/react'
import CopyBtn from '@/app/components/base/copy-btn'
import Indicator from '@/app/components/header/indicator'
import Switch from '@/app/components/base/switch'

const EndpointCard = () => {
  const { t } = useTranslation()
  return (
    <div className='p-0.5 bg-background-section-burn rounded-xl'>
      <div className='p-2.5 pl-3 bg-components-panel-on-panel-item-bg rounded-[10px] border-[0.5px] border-components-panel-border'>
        <div className='mb-1 h-6 flex items-center gap-1 text-text-secondary system-md-semibold'>
          <RiLoginCircleLine className='w-4 h-4' />
          <div>Endpoint for Unreal workspace</div>
        </div>
        <div className='h-6 flex items-center'>
          <div className='shrink-0 w-24 text-text-tertiary system-xs-regular'>Start Callback</div>
          <div className='group grow flex items-center text-text-secondary system-xs-regular truncate'>
            <div className='truncate'>https://extension.dify.ai/a1b2c3d4/onStart</div>
            <CopyBtn
              className='hidden shrink-0 ml-2 group-hover:block'
              value={'https://extension.dify.ai/a1b2c3d4/onStart'}
              isPlain
            />
          </div>
        </div>
        <div className='h-6 flex items-center'>
          <div className='shrink-0 w-24 text-text-tertiary system-xs-regular'>Finish Callback</div>
          <div className='group grow flex items-center text-text-secondary system-xs-regular truncate'>
            <div className='truncate'>https://extension.dify.ai/a1b2c3d4/onFinish</div>
            <CopyBtn
              className='hidden shrink-0 ml-2 group-hover:block'
              value={'https://extension.dify.ai/a1b2c3d4/onFinish'}
              isPlain
            />
          </div>
        </div>
      </div>
      <div className='px-3 py-2 flex items-center justify-between'>
        <div className='flex items-center gap-1 system-xs-semibold-uppercase text-util-colors-green-green-600'>
          <Indicator color='green' />
          {t('plugin.detailPanel.serviceOk')}
        </div>
        {/* <div className='flex items-center gap-1 system-xs-semibold-uppercase text-text-tertiary'>
          <Indicator color='gray' />
          {t('plugin.detailPanel.disabled')}
        </div> */}
        <Switch
          className='ml-3'
          defaultValue={true}
          onChange={() => {}}
          size='sm'
        />
      </div>
    </div>
  )
}

export default EndpointCard
