import type { FC } from 'react'
import React from 'react'
import { RiVerifiedBadgeLine } from '@remixicon/react'
import Badge from '../base/badge'
import type { Plugin } from './types'
import Description from './card/base/description'
import Icon from './card/base/icon'
import Title from './card/base/title'
import DownloadCount from './card/base/download-count'
import { getLocaleOnServer } from '@/i18n/server'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  payload: Plugin
}

const PluginItem: FC<Props> = async ({
  className,
  payload,
}) => {
  const locale = getLocaleOnServer()
  const { org, label } = payload

  return (
    <div className='p-1 bg-background-section-burn rounded-xl'>
      <div className={cn('relative p-4 pb-3 border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg rounded-xl shadow-xs', className)}>
        {/* Header */}
        <div className="flex">
          <Icon src={payload.icon} />
          <div className="ml-3 w-0 grow">
            <div className="flex items-center h-5">
              <Title title={label[locale]} />
              <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" />
            </div>
            <div className='mb-1 flex justify-between items-center h-4'>
              <div className='flex items-center'>
                <div className='text-text-tertiary system/xs-regular'>{org}</div>
                <div className='mx-2 text-text-quaternary system-xs-regular'>·</div>
                <DownloadCount downloadCount={payload.install_count || 0} />
              </div>
            </div>
          </div>
        </div>
        <Description className='mt-3' text={payload.brief[locale]} descriptionLineRows={2}></Description>
        <div className='mt-3 flex space-x-0.5'>
          {['LLM', 'text embedding', 'speech2text'].map(tag => (
            <Badge key={tag} text={tag} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default PluginItem
