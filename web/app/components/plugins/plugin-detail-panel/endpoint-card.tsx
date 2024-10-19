import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine, RiEditLine, RiLoginCircleLine } from '@remixicon/react'
import type { EndpointListItem } from '../types'
import ActionButton from '@/app/components/base/action-button'
import CopyBtn from '@/app/components/base/copy-btn'
import Indicator from '@/app/components/header/indicator'
import Switch from '@/app/components/base/switch'
import {
  disableEndpoint,
  enableEndpoint,
} from '@/service/plugins'

type Props = {
  data: EndpointListItem
}

const EndpointCard = ({
  data,
}: Props) => {
  const { t } = useTranslation()
  const [active, setActive] = useState(data.enabled)
  const endpointID = data.id

  const activeEndpoint = async () => {
    try {
      await enableEndpoint({
        url: '/workspaces/current/endpoints/enable',
        endpointID,
      })
    }
    catch (error) {
      console.error(error)
      setActive(true)
    }
  }
  const inactiveEndpoint = async () => {
    try {
      await disableEndpoint({
        url: '/workspaces/current/endpoints/disable',
        endpointID,
      })
    }
    catch (error) {
      console.error(error)
      setActive(false)
    }
  }
  const handleSwitch = (state: boolean) => {
    if (state)
      activeEndpoint()
    else
      inactiveEndpoint()
  }

  return (
    <div className='p-0.5 bg-background-section-burn rounded-xl'>
      <div className='group p-2.5 pl-3 bg-components-panel-on-panel-item-bg rounded-[10px] border-[0.5px] border-components-panel-border'>
        <div className='flex items-center'>
          <div className='grow mb-1 h-6 flex items-center gap-1 text-text-secondary system-md-semibold'>
            <RiLoginCircleLine className='w-4 h-4' />
            <div>{data.name}</div>
          </div>
          <div className='hidden group-hover:flex items-center'>
            <ActionButton>
              <RiEditLine className='w-4 h-4' />
            </ActionButton>
            <ActionButton className='hover:bg-state-destructive-hover text-text-tertiary hover:text-text-destructive'>
              <RiDeleteBinLine className='w-4 h-4' />
            </ActionButton>
          </div>
        </div>
        {data.declaration.endpoints.map((endpoint, index) => (
          <div key={index} className='h-6 flex items-center'>
            <div className='shrink-0 w-12 text-text-tertiary system-xs-regular'>{endpoint.method}</div>
            <div className='group/item grow flex items-center text-text-secondary system-xs-regular truncate'>
              <div className='truncate'>{`${data.url}${endpoint.path}`}</div>
              <CopyBtn
                className='hidden shrink-0 ml-2 group-hover/item:block'
                value={`${data.url}${endpoint.path}`}
                isPlain
              />
            </div>
          </div>
        ))}
      </div>
      <div className='p-2 pl-3 flex items-center justify-between'>
        {active && (
          <div className='flex items-center gap-1 system-xs-semibold-uppercase text-util-colors-green-green-600'>
            <Indicator color='green' />
            {t('plugin.detailPanel.serviceOk')}
          </div>
        )}
        {!active && (
          <div className='flex items-center gap-1 system-xs-semibold-uppercase text-text-tertiary'>
            <Indicator color='gray' />
            {t('plugin.detailPanel.disabled')}
          </div>
        )}
        <Switch
          className='ml-3'
          defaultValue={active}
          onChange={handleSwitch}
          size='sm'
        />
      </div>
    </div>
  )
}

export default EndpointCard
