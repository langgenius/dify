import type { FC } from 'react'
import React from 'react'
import { RiArrowRightUpLine, RiLoginCircleLine, RiVerifiedBadgeLine } from '@remixicon/react'
import { Github } from '../../base/icons/src/public/common'
import Badge from '../../base/badge'
import type { Plugin } from '../types'
import CornerMark from '../card/base/corner-mark'
import Description from '../card/base/description'
import Icon from '../card/base/icon'
import OrgInfo from '../card/base/org-info'
import Title from '../card/base/title'
import Action from './action'
import { getLocaleOnServer, useTranslation as translate } from '@/i18n/server'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  payload: Plugin
  onDelete: () => void
}

const PluginItem: FC<Props> = async ({
  className,
  payload,
  onDelete,
}) => {
  const locale = getLocaleOnServer()
  const { t: pluginI8n } = await translate(locale, 'plugin')

  const { type, name, org, label } = payload
  const hasNewVersion = payload.latest_version !== payload.version

  return (
    <div className='p-1 bg-background-section-burn rounded-xl'>
      <div className={cn('relative p-4 pb-3 border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg rounded-xl shadow-xs', className)}>
        <CornerMark text={type} />
        {/* Header */}
        <div className="flex">
          <Icon src={payload.icon} />
          <div className="ml-3 w-0 grow">
            <div className="flex items-center h-5">
              <Title title={label[locale]} />
              <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" />
              <Badge className='ml-1' text={payload.version} hasRedCornerMark={hasNewVersion} />
            </div>
            <div className='flex items-center justify-between'>
              <Description text={payload.brief[locale]} descriptionLineRows={1}></Description>
              <Action
                pluginId='xxx'
                isShowFetchNewVersion={hasNewVersion}
                isShowInfo
                isShowDelete
                onDelete={onDelete}
              />
            </div>
          </div>
        </div>
      </div>
      <div className='mt-1.5 mb-1 flex justify-between items-center h-4 px-3'>
        <div className='flex items-center'>
          <OrgInfo
            className="mt-0.5"
            orgName={org}
            packageName={name}
            packageNameClassName='w-auto max-w-[150px]'
          />
          <div className='mx-2 text-text-quaternary system-xs-regular'>·</div>
          <div className='flex text-text-tertiary system-xs-regular space-x-1'>
            <RiLoginCircleLine className='w-4 h-4' />
            <span>{pluginI8n('endpointsEnabled', { num: 2 })}</span>
          </div>
        </div>

        <div className='flex items-center'>
          <a href='' target='_blank' className='mr-1 text-text-tertiary system-2xs-medium-uppercase'>{pluginI8n('from')}</a>
          <div className='flex items-center space-x-0.5 text-text-secondary'>
            <Github className='ml-1 w-3 h-3' />
            <div className='system-2xs-semibold-uppercase'>GitHub</div>
            <RiArrowRightUpLine className='w-3 h-3' />
          </div>
        </div>
      </div>
    </div>
  )
}

export default PluginItem
