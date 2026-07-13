'use client'
import type { Plugin } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from '#i18n'
import { useGetLanguage } from '@/context/i18n'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import useTheme from '@/hooks/use-theme'
import { renderI18nObject } from '@/i18n-config'
import { Theme } from '@/types/app'
import { formatNumber } from '@/utils/format'
import Partner from '../base/badges/partner'
import Verified from '../base/badges/verified'
import Icon from '../card/base/card-icon'
import { useCategories } from '../hooks'
import { getPluginCardIconUrl } from '../utils'
import CornerMark from './base/corner-mark'
import Description from './base/description'
import OrgInfo from './base/org-info'
import Placeholder from './base/placeholder'
import Title from './base/title'

export type CardPayload = Omit<Plugin, 'icon' | 'icon_dark'> & {
  icon: string | { content: string; background: string }
  icon_dark?: string | { content: string; background: string }
}

type Props = Readonly<{
  className?: string
  payload: CardPayload
  titleLeft?: React.ReactNode
  installed?: boolean
  installFailed?: boolean
  hideCornerMark?: boolean
  descriptionLineRows?: number
  footer?: React.ReactNode
  isLoading?: boolean
  loadingFileName?: string
  limitedInstall?: boolean
  compact?: boolean
  variant?: 'default' | 'marketplace'
}>

const Card = ({
  className,
  payload,
  titleLeft,
  installed,
  installFailed,
  hideCornerMark,
  descriptionLineRows,
  footer,
  isLoading = false,
  loadingFileName,
  limitedInstall = false,
  compact = false,
  variant = 'default',
}: Props) => {
  const locale = useGetLanguage()
  const { t } = useTranslation()
  const { categoriesMap } = useCategories(true)
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const { category, type, name, org, label, brief, icon, icon_dark, verified, from } = payload
  const badges = payload.badges ?? []
  const { theme } = useTheme()
  const iconSrc = getPluginCardIconUrl(
    { from, name, org, type },
    theme === Theme.dark && icon_dark ? icon_dark : icon,
    currentWorkspaceId,
  )
  const getLocalizedText = (obj: Record<string, string> | undefined) =>
    obj ? renderI18nObject(obj, locale) : ''
  const isPartner = badges.includes('partner')
  const effectiveDescriptionLineRows = descriptionLineRows ?? (compact ? 1 : 2)
  const isMarketplaceVariant = variant === 'marketplace'
  const cornerMarkText = categoriesMap[type === 'bundle' ? type : category]?.label ?? ''

  const wrapClassName = cn(
    // oxlint-disable-next-line tailwindcss/no-unknown-classes -- Used by page feedback tooling to identify plugin cards.
    'hover-bg-components-panel-on-panel-item-bg relative overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs',
    isMarketplaceVariant &&
      'h-[148px] transition-all group-hover:bg-components-panel-on-panel-item-bg-hover group-hover:shadow-md',
    className,
  )
  if (isLoading) {
    return <Placeholder wrapClassName={wrapClassName} loadingFileName={loadingFileName!} />
  }

  if (isMarketplaceVariant) {
    return (
      <div className={wrapClassName}>
        <div className="relative flex h-full flex-col">
          {!hideCornerMark && <CornerMark text={cornerMarkText} />}
          <div className="flex items-center gap-3 px-4 pt-4 pb-2">
            <Icon src={iconSrc} installed={installed} installFailed={installFailed} />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
              <div className="flex h-5 min-w-0 items-center">
                <div className="truncate system-md-medium text-text-primary">
                  {getLocalizedText(label)}
                </div>
                {isPartner && (
                  <Partner
                    className="ml-0.5 size-4"
                    text={t(($) => $['marketplace.partnerTip'], { ns: 'plugin' })}
                  />
                )}
                {verified && (
                  <Verified
                    className="ml-0.5 size-4"
                    text={t(($) => $['marketplace.verifiedTip'], { ns: 'plugin' })}
                  />
                )}
                {titleLeft}
              </div>
              <div className="flex h-4 min-w-0 items-center gap-2 system-xs-regular text-text-tertiary">
                {org && (
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="shrink-0 lowercase">
                      {t(($) => $.author, { ns: 'tools' })}
                    </span>
                    <span className="truncate">{org}</span>
                  </div>
                )}
                {org && payload.install_count !== undefined && (
                  <span className="shrink-0 text-text-quaternary">·</span>
                )}
                {payload.install_count !== undefined && (
                  <span className="shrink-0">
                    {t(($) => $.install, {
                      ns: 'plugin',
                      num: formatNumber(payload.install_count),
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Description
            className="mx-4 mt-1 text-text-secondary"
            text={getLocalizedText(brief)}
            descriptionLineRows={effectiveDescriptionLineRows}
          />
          {!!footer && <div className="px-4 pt-2 pr-5">{footer}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className={wrapClassName}>
      <div className={cn(compact ? 'p-3 pb-2' : 'p-4 pb-3', limitedInstall && 'pb-1')}>
        {!hideCornerMark && <CornerMark text={cornerMarkText} />}
        {/* Header */}
        <div className="flex">
          <Icon src={iconSrc} installed={installed} installFailed={installFailed} />
          <div className="ml-3 w-0 grow">
            <div className="flex h-5 items-center">
              <Title title={getLocalizedText(label)} />
              {isPartner && (
                <Partner
                  className="ml-0.5 size-4"
                  text={t(($) => $['marketplace.partnerTip'], { ns: 'plugin' })}
                />
              )}
              {verified && (
                <Verified
                  className="ml-0.5 size-4"
                  text={t(($) => $['marketplace.verifiedTip'], { ns: 'plugin' })}
                />
              )}
              {titleLeft} {/* This can be version badge */}
            </div>
            <OrgInfo className="mt-0.5" orgName={org} packageName={name} />
          </div>
        </div>
        <Description
          className={compact ? 'mt-1' : 'mt-3'}
          text={getLocalizedText(brief)}
          descriptionLineRows={effectiveDescriptionLineRows}
        />
        {!!footer && <div>{footer}</div>}
      </div>
      {limitedInstall && (
        <div className="relative flex h-8 items-center gap-x-2 px-3 after:absolute after:inset-0 after:bg-toast-warning-bg after:opacity-40">
          <span
            aria-hidden
            className="i-ri-alert-fill size-3 shrink-0 text-text-warning-secondary"
          />
          <p className="z-10 grow system-xs-regular text-text-secondary">
            {t(($) => $['installModal.installWarning'], { ns: 'plugin' })}
          </p>
        </div>
      )}
    </div>
  )
}

export default React.memo(Card)
