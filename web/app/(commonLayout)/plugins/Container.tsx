'use client'

import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightUpLine,
  RiBugLine,
  RiDragDropLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import InstallPluginDropdown from './InstallPluginDropdown'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import Button from '@/app/components/base/button'
import TabSlider from '@/app/components/base/tab-slider'
import Tooltip from '@/app/components/base/tooltip'

const Container = () => {
  const { t } = useTranslation()

  const options = useMemo(() => {
    return [
      { value: 'plugins', text: t('common.menus.plugins') },
      { value: 'discover', text: 'Discover in Marketplace' },
    ]
  }, [t])

  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: 'plugins',
  })

  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={containerRef} className='grow relative flex flex-col rounded-t-xl bg-components-panel-bg border-t
    border-divider-subtle overflow-y-auto'>
      <div className='flex min-h-[60px] px-12 pt-4 pb-2 items-center self-stretch gap-1'>
        <div className='flex justify-between items-center w-full'>
          <div className='flex-1'>
            <TabSlider
              value={activeTab}
              onChange={newActiveTab => setActiveTab(newActiveTab)}
              options={options}
            />
          </div>
          <div className='flex flex-shrink-0 items-center gap-1'>
            <InstallPluginDropdown />
            <Tooltip
              triggerMethod='click'
              popupContent={
                <>
                  <div className='flex items-center gap-1 self-stretch'>
                    <span className='flex flex-col justify-center items-start flex-grow flex-shrink-0 basis-0 text-text-secondary system-sm-semibold'>Debugging</span>
                    <div className='flex items-center gap-0.5 text-text-accent-light-mode-only cursor-pointer'>
                      <span className='system-xs-medium'>View docs</span>
                      <RiArrowRightUpLine className='w-3 h-3' />
                    </div>
                  </div>
                  <div className='flex flex-col items-start gap-0.5 self-stretch'>
                    <div className='flex items-center gap-1 self-stretch'>
                      <span className='flex w-10 flex-col justify-center items-start text-text-tertiary system-xs-medium'>Port</span>
                    </div>
                  </div>
                </>
              }
              popupClassName='flex flex-col items-start w-[256px] px-4 py-3.5 gap-1 border border-components-panel-border
                  rounded-xl bg-components-tooltip-bg shadows-shadow-lg'
              asChild={false}
              position='bottom'
            >
              <Button className='w-full h-full p-2 text-components-button-secondary-text'>
                <RiBugLine className='w-4 h-4' />
              </Button>
            </Tooltip>
            <Button className='w-full h-full p-2 text-components-button-secondary-text'>
              <RiEqualizer2Line className='w-4 h-4' />
            </Button>
          </div>
        </div>
      </div>
      <div className='flex flex-col flex-grow pt-1 pb-3 px-12 justify-center items-start gap-3 self-stretch'>
        <div className='h-px self-stretch bg-divider-subtle'></div>
        <div className='flex items-center gap-2 self-stretch'>
          {/* Content for active tab will go here */}
        </div>
      </div>
      <div className='flex items-center justify-center py-4 gap-2 text-text-quaternary'>
        <RiDragDropLine className='w-4 h-4' />
        <span className='system-xs-regular'>Drop plugin package here to install</span>
      </div>
    </div>
  )
}

export default Container
