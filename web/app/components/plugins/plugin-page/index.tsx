'use client'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightUpLine,
  RiBugLine,
  RiClipboardLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import {
  PluginPageContextProvider,
  usePluginPageContext,
} from './context'
import InstallPluginDropdown from './install-plugin-dropdown'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import { useModalContext } from '@/context/modal-context'
import Button from '@/app/components/base/button'
import TabSlider from '@/app/components/base/tab-slider'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

export type PluginPageProps = {
  plugins: React.ReactNode
  marketplace: React.ReactNode
}
const PluginPage = ({
  plugins,
  marketplace,
}: PluginPageProps) => {
  const { t } = useTranslation()
  const { setShowPluginSettingModal } = useModalContext() as any
  const containerRef = usePluginPageContext(v => v.containerRef)

  const options = useMemo(() => {
    return [
      { value: 'plugins', text: t('common.menus.plugins') },
      { value: 'discover', text: 'Explore Marketplace' },
    ]
  }, [t])

  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: options[0].value,
  })

  return (
    <div
      ref={containerRef}
      className={cn('grow relative flex flex-col overflow-y-auto border-t border-divider-subtle', activeTab === 'plugins'
        ? 'rounded-t-xl bg-components-panel-bg'
        : 'bg-background-body',
      )}
    >
      <div
        className={cn(
          'sticky top-0 flex min-h-[60px] px-12 pt-4 pb-2 items-center self-stretch gap-1 bg-background-body z-10',
        )}
      >
        <div className='flex justify-between items-center w-full'>
          <div className='flex-1'>
            <TabSlider
              value={activeTab}
              onChange={setActiveTab}
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
                    {['Port', 'Key'].map((label, index) => (
                      <div key={label} className='flex items-center gap-1 self-stretch'>
                        <span className='flex w-10 flex-col justify-center items-start text-text-tertiary system-xs-medium'>{label}</span>
                        <div className='flex justify-center items-center gap-0.5'>
                          <span className='system-xs-medium text-text-secondary'>
                            {index === 0 ? 'cloud.dify,ai:2048' : 'A1B2C3D4E5F6G7H8'}
                          </span>
                          <ActionButton>
                            <RiClipboardLine className='w-3.5 h-3.5 text-text-tertiary' />
                          </ActionButton>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              }
              popupClassName='flex flex-col items-start w-[256px] px-4 py-3.5 gap-1 border border-components-panel-border
                  rounded-xl bg-components-tooltip-bg shadows-shadow-lg z-50'
              asChild={false}
              position='bottom'
            >
              <Button className='w-full h-full p-2 text-components-button-secondary-text'>
                <RiBugLine className='w-4 h-4' />
              </Button>
            </Tooltip>
            <Button
              className='w-full h-full p-2 text-components-button-secondary-text group'
              onClick={() => {
                setShowPluginSettingModal()
              }}
            >
              <RiEqualizer2Line className='w-4 h-4' />
            </Button>
          </div>
        </div>
      </div>
      {
        activeTab === 'plugins' && plugins
      }
      {
        activeTab === 'discover' && marketplace
      }
    </div>
  )
}

const PluginPageWithContext = (props: PluginPageProps) => {
  return (
    <PluginPageContextProvider>
      <PluginPage {...props} />
    </PluginPageContextProvider>
  )
}

export default PluginPageWithContext
