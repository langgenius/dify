'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import { RiArrowRightUpLine, RiBugLine, RiHardDrive3Line, RiLoginCircleLine, RiVerifiedBadgeLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { Github } from '../../base/icons/src/public/common'
import Badge from '../../base/badge'
import type { Plugin } from '../types'
import CornerMark from '../card/base/corner-mark'
import Description from '../card/base/description'
import Icon from '../card/base/card-icon'
import OrgInfo from '../card/base/org-info'
import Title from '../card/base/title'
import Action from './action'
import cn from '@/utils/classnames'
import I18n from '@/context/i18n'

type Props = {
  className?: string
  payload: Plugin
  source: 'github' | 'marketplace' | 'local' | 'debug'
  onDelete: () => void
}

const PluginItem: FC<Props> = ({
  className,
  payload,
  source,
  onDelete,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()

  const { type, name, org, label } = payload
  const hasNewVersion = payload.latest_version !== payload.version

  return (
    <div className={`p-1 ${source === 'debug'
      ? 'bg-[repeating-linear-gradient(-45deg,rgba(16,24,40,0.04),rgba(16,24,40,0.04)_5px,rgba(0,0,0,0.02)_5px,rgba(0,0,0,0.02)_10px)]'
      : 'bg-background-section-burn'} 
      rounded-xl`}
    >
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
                pluginName={label[locale]}
                usedInApps={5}
                isShowFetchNewVersion={hasNewVersion}
                isShowInfo
                isShowDelete
                onDelete={onDelete}
              />
            </div>
          </div>
        </div>
      </div>
      <div className='mt-1.5 mb-1 flex justify-between items-center h-4 px-4'>
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
            <span>{t('plugin.endpointsEnabled', { num: 2 })}</span>
          </div>
        </div>

        <div className='flex items-center'>
          {source === 'github'
            && <>
              <a href='' target='_blank' className='flex items-center gap-1'>
                <div className='text-text-tertiary system-2xs-medium-uppercase'>{t('plugin.from')}</div>
                <div className='flex items-center space-x-0.5 text-text-secondary'>
                  <Github className='w-3 h-3' />
                  <div className='system-2xs-semibold-uppercase'>GitHub</div>
                  <RiArrowRightUpLine className='w-3 h-3' />
                </div>
              </a>
            </>
          }
          {source === 'marketplace'
            && <>
              <a href='' target='_blank' className='flex items-center gap-0.5'>
                <div className='text-text-tertiary system-2xs-medium-uppercase'>{t('plugin.from')} <span className='text-text-secondary'>marketplace</span></div>
                <RiArrowRightUpLine className='w-3 h-3' />
              </a>
            </>
          }
          {source === 'local'
            && <>
              <div className='flex items-center gap-1'>
                <RiHardDrive3Line className='text-text-tertiary w-3 h-3' />
                <div className='text-text-tertiary system-2xs-medium-uppercase'>Local Plugin</div>
              </div>
            </>
          }
          {source === 'debug'
            && <>
              <div className='flex items-center gap-1'>
                <RiBugLine className='w-3 h-3 text-text-warning' />
                <div className='text-text-warning system-2xs-medium-uppercase'>Debugging Plugin</div>
              </div>
            </>
          }
        </div>
      </div>
    </div>
  )
}

export default React.memo(PluginItem)
