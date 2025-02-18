'use client'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import {
  RiArrowRightUpLine,
  RiBugLine,
  RiHardDrive3Line,
  RiLoginCircleLine,
  RiVerifiedBadgeLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { usePluginPageContext } from '../plugin-page/context'
import { Github } from '../../base/icons/src/public/common'
import Badge from '../../base/badge'
import { type PluginDetail, PluginSource, PluginType } from '../types'
import CornerMark from '../card/base/corner-mark'
import Description from '../card/base/description'
import OrgInfo from '../card/base/org-info'
import Title from '../card/base/title'
import Action from './action'
import cn from '@/utils/classnames'
import { API_PREFIX, MARKETPLACE_URL_PREFIX } from '@/config'
import { useSingleCategories } from '../hooks'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'

type Props = {
  className?: string
  plugin: PluginDetail
}

const PluginItem: FC<Props> = ({
  className,
  plugin,
}) => {
  const { t } = useTranslation()
  const { categoriesMap } = useSingleCategories()
  const currentPluginID = usePluginPageContext(v => v.currentPluginID)
  const setCurrentPluginID = usePluginPageContext(v => v.setCurrentPluginID)
  const { refreshPluginList } = useRefreshPluginList()

  const {
    source,
    tenant_id,
    installation_id,
    plugin_unique_identifier,
    endpoints_active,
    meta,
    plugin_id,
  } = plugin
  const { category, author, name, label, description, icon, verified } = plugin.declaration

  const orgName = useMemo(() => {
    return [PluginSource.github, PluginSource.marketplace].includes(source) ? author : ''
  }, [source, author])

  const handleDelete = () => {
    refreshPluginList({ category } as any)
  }
  const getValueFromI18nObject = useRenderI18nObject()
  const title = getValueFromI18nObject(label)
  const descriptionText = getValueFromI18nObject(description)

  return (
    <div
      className={cn(
        'border-background-section-burn rounded-xl border-[1.5px] p-1',
        currentPluginID === plugin_id && 'border-components-option-card-option-selected-border',
        source === PluginSource.debugging
          ? 'bg-[repeating-linear-gradient(-45deg,rgba(16,24,40,0.04),rgba(16,24,40,0.04)_5px,rgba(0,0,0,0.02)_5px,rgba(0,0,0,0.02)_10px)]'
          : 'bg-background-section-burn',
      )}
      onClick={() => {
        setCurrentPluginID(plugin.plugin_id)
      }}
    >
      <div className={cn('border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg shadow-xs relative rounded-xl border-[0.5px] p-4 pb-3', className)}>
        <CornerMark text={categoriesMap[category].label} />
        {/* Header */}
        <div className="flex">
          <div className='border-components-panel-border-subtle flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border-[1px]'>
            <img
              className='h-full w-full'
              src={`${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${tenant_id}&filename=${icon}`}
              alt={`plugin-${plugin_unique_identifier}-logo`}
            />
          </div>
          <div className="ml-3 w-0 grow">
            <div className="flex h-5 items-center">
              <Title title={title} />
              {verified && <RiVerifiedBadgeLine className="text-text-accent ml-0.5 h-4 w-4 shrink-0" />}
              <Badge className='ml-1 shrink-0' text={source === PluginSource.github ? plugin.meta!.version : plugin.version} />
            </div>
            <div className='flex items-center justify-between'>
              <Description text={descriptionText} descriptionLineRows={1}></Description>
              <div onClick={e => e.stopPropagation()}>
                <Action
                  pluginUniqueIdentifier={plugin_unique_identifier}
                  installationId={installation_id}
                  author={author}
                  pluginName={name}
                  usedInApps={5}
                  isShowFetchNewVersion={source === PluginSource.github}
                  isShowInfo={source === PluginSource.github}
                  isShowDelete
                  meta={meta}
                  onDelete={handleDelete}
                  category={category}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className='mb-1 mt-1.5 flex h-4 items-center justify-between px-4'>
        <div className='flex items-center'>
          <OrgInfo
            className="mt-0.5"
            orgName={orgName}
            packageName={name}
            packageNameClassName='w-auto max-w-[150px]'
          />
          {category === PluginType.extension && (
            <>
              <div className='text-text-quaternary system-xs-regular mx-2'>·</div>
              <div className='text-text-tertiary system-xs-regular flex space-x-1'>
                <RiLoginCircleLine className='h-4 w-4' />
                <span>{t('plugin.endpointsEnabled', { num: endpoints_active })}</span>
              </div>
            </>
          )}
        </div>

        <div className='flex items-center'>
          {source === PluginSource.github
            && <>
              <a href={`https://github.com/${meta!.repo}`} target='_blank' className='flex items-center gap-1'>
                <div className='text-text-tertiary system-2xs-medium-uppercase'>{t('plugin.from')}</div>
                <div className='text-text-secondary flex items-center space-x-0.5'>
                  <Github className='h-3 w-3' />
                  <div className='system-2xs-semibold-uppercase'>GitHub</div>
                  <RiArrowRightUpLine className='h-3 w-3' />
                </div>
              </a>
            </>
          }
          {source === PluginSource.marketplace
            && <>
              <a href={`${MARKETPLACE_URL_PREFIX}/plugins/${author}/${name}`} target='_blank' className='flex items-center gap-0.5'>
                <div className='text-text-tertiary system-2xs-medium-uppercase'>{t('plugin.from')} <span className='text-text-secondary'>marketplace</span></div>
                <RiArrowRightUpLine className='text-text-tertiary h-3 w-3' />
              </a>
            </>
          }
          {source === PluginSource.local
            && <>
              <div className='flex items-center gap-1'>
                <RiHardDrive3Line className='text-text-tertiary h-3 w-3' />
                <div className='text-text-tertiary system-2xs-medium-uppercase'>Local Plugin</div>
              </div>
            </>
          }
          {source === PluginSource.debugging
            && <>
              <div className='flex items-center gap-1'>
                <RiBugLine className='text-text-warning h-3 w-3' />
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
