'use client'
import type { FC } from 'react'
import type { PluginDetail } from '../types'
import {
  RiArrowRightUpLine,
  RiBugLine,
  RiErrorWarningLine,
  RiHardDrive3Line,
  RiLoginCircleLine,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { gte } from 'semver'
import Tooltip from '@/app/components/base/tooltip'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import { API_PREFIX } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import useTheme from '@/hooks/use-theme'
import { cn } from '@/utils/classnames'
import { getMarketplaceUrl } from '@/utils/var'
import Badge from '../../base/badge'
import { Github } from '../../base/icons/src/public/common'
import Verified from '../base/badges/verified'
import CornerMark from '../card/base/corner-mark'
import Description from '../card/base/description'
import OrgInfo from '../card/base/org-info'
import Title from '../card/base/title'
import { useCategories } from '../hooks'
import { usePluginPageContext } from '../plugin-page/context'
import { PluginCategoryEnum, PluginSource } from '../types'
import Action from './action'

type Props = {
  className?: string
  plugin: PluginDetail
}

const PluginItem: FC<Props> = ({
  className,
  plugin,
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { categoriesMap } = useCategories(true)
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
    status,
    deprecated_reason,
  } = plugin
  const { category, author, name, label, description, icon, icon_dark, verified, meta: declarationMeta } = plugin.declaration

  const orgName = useMemo(() => {
    return [PluginSource.github, PluginSource.marketplace].includes(source) ? author : ''
  }, [source, author])

  const { langGeniusVersionInfo } = useAppContext()

  const isDifyVersionCompatible = useMemo(() => {
    if (!langGeniusVersionInfo.current_version)
      return true
    return gte(langGeniusVersionInfo.current_version, declarationMeta.minimum_dify_version ?? '0.0.0')
  }, [declarationMeta.minimum_dify_version, langGeniusVersionInfo.current_version])

  const isDeprecated = useMemo(() => {
    return status === 'deleted' && !!deprecated_reason
  }, [status, deprecated_reason])

  const handleDelete = useCallback(() => {
    refreshPluginList({ category } as any)
  }, [category, refreshPluginList])

  const getValueFromI18nObject = useRenderI18nObject()
  const title = getValueFromI18nObject(label)
  const descriptionText = getValueFromI18nObject(description)
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  const iconFileName = theme === 'dark' && icon_dark ? icon_dark : icon
  const iconSrc = iconFileName
    ? (iconFileName.startsWith('http') ? iconFileName : `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${tenant_id}&filename=${iconFileName}`)
    : ''

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border-[1.5px] border-background-section-burn p-1',
        currentPluginID === plugin_id && 'border-components-option-card-option-selected-border',
        source === PluginSource.debugging
          ? 'bg-[repeating-linear-gradient(-45deg,rgba(16,24,40,0.04),rgba(16,24,40,0.04)_5px,rgba(0,0,0,0.02)_5px,rgba(0,0,0,0.02)_10px)]'
          : 'bg-background-section-burn',
      )}
      onClick={() => {
        setCurrentPluginID(plugin.plugin_id)
      }}
    >
      <div className={cn('hover-bg-components-panel-on-panel-item-bg relative z-10 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 pb-3 shadow-xs', className)}>
        <CornerMark text={categoriesMap[category].label} />
        {/* Header */}
        <div className="flex">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border-[1px] border-components-panel-border-subtle">
            <img
              className="h-full w-full"
              src={iconSrc}
              alt={`plugin-${plugin_unique_identifier}-logo`}
            />
          </div>
          <div className="ml-3 w-0 grow">
            <div className="flex h-5 items-center">
              <Title title={title} />
              {verified && <Verified className="ml-0.5 h-4 w-4" text={t('marketplace.verifiedTip', { ns: 'plugin' })} />}
              {!isDifyVersionCompatible && (
                <Tooltip popupContent={
                  t('difyVersionNotCompatible', { ns: 'plugin', minimalDifyVersion: declarationMeta.minimum_dify_version })
                }
                >
                  <RiErrorWarningLine color="red" className="ml-0.5 h-4 w-4 shrink-0 text-text-accent" />
                </Tooltip>
              )}
              <Badge
                className="ml-1 shrink-0"
                text={source === PluginSource.github ? plugin.meta!.version : plugin.version}
                hasRedCornerMark={(source === PluginSource.marketplace) && !!plugin.latest_version && plugin.latest_version !== plugin.version}
              />
            </div>
            <div className="flex items-center justify-between">
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
      <div className="mb-1 mt-1.5 flex h-4 items-center gap-x-2 px-4">
        {/* Organization & Name */}
        <div className="flex grow items-center overflow-hidden">
          <OrgInfo
            orgName={orgName}
            packageName={name}
            packageNameClassName="w-auto max-w-[150px]"
          />
          {category === PluginCategoryEnum.extension && (
            <>
              <div className="system-xs-regular mx-2 text-text-quaternary">·</div>
              <div className="system-xs-regular flex items-center gap-x-1 overflow-hidden text-text-tertiary">
                <RiLoginCircleLine className="size-3 shrink-0" />
                <span
                  className="truncate"
                  title={t('endpointsEnabled', { ns: 'plugin', num: endpoints_active })}
                >
                  {t('endpointsEnabled', { ns: 'plugin', num: endpoints_active })}
                </span>
              </div>
            </>
          )}
        </div>
        {/* Source */}
        <div className="flex shrink-0 items-center">
          {source === PluginSource.github
            && (
              <>
                <a href={`https://github.com/${meta!.repo}`} target="_blank" className="flex items-center gap-1">
                  <div className="system-2xs-medium-uppercase text-text-tertiary">{t('from', { ns: 'plugin' })}</div>
                  <div className="flex items-center space-x-0.5 text-text-secondary">
                    <Github className="h-3 w-3" />
                    <div className="system-2xs-semibold-uppercase">GitHub</div>
                    <RiArrowRightUpLine className="h-3 w-3" />
                  </div>
                </a>
              </>
            )}
          {source === PluginSource.marketplace && enable_marketplace
            && (
              <>
                <a href={getMarketplaceUrl(`/plugins/${author}/${name}`, { theme })} target="_blank" className="flex items-center gap-0.5">
                  <div className="system-2xs-medium-uppercase text-text-tertiary">
                    {t('from', { ns: 'plugin' })}
                    {' '}
                    <span className="text-text-secondary">marketplace</span>
                  </div>
                  <RiArrowRightUpLine className="h-3 w-3 text-text-secondary" />
                </a>
              </>
            )}
          {source === PluginSource.local
            && (
              <>
                <div className="flex items-center gap-1">
                  <RiHardDrive3Line className="h-3 w-3 text-text-tertiary" />
                  <div className="system-2xs-medium-uppercase text-text-tertiary">Local Plugin</div>
                </div>
              </>
            )}
          {source === PluginSource.debugging
            && (
              <>
                <div className="flex items-center gap-1">
                  <RiBugLine className="h-3 w-3 text-text-warning" />
                  <div className="system-2xs-medium-uppercase text-text-warning">Debugging Plugin</div>
                </div>
              </>
            )}
        </div>
        {/* Deprecated */}
        {source === PluginSource.marketplace && enable_marketplace && isDeprecated && (
          <div className="system-2xs-medium-uppercase flex shrink-0 items-center gap-x-2">
            <span className="text-text-tertiary">·</span>
            <span className="text-text-warning">
              {t('deprecated', { ns: 'plugin' })}
            </span>
          </div>
        )}
      </div>
      {/* BG Effect for Deprecated Plugin */}
      {source === PluginSource.marketplace && enable_marketplace && isDeprecated && (
        <div className="absolute bottom-[-71px] right-[-45px] z-0 size-40 bg-components-badge-status-light-warning-halo opacity-60 blur-[120px]" />
      )}
    </div>
  )
}

export default React.memo(PluginItem)
