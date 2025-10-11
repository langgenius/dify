'use client'
import React from 'react'
import type { Plugin } from '../types'
import Icon from '../card/base/card-icon'
import CornerMark from './base/corner-mark'
import Title from './base/title'
import OrgInfo from './base/org-info'
import Description from './base/description'
import Placeholder from './base/placeholder'
import cn from '@/utils/classnames'
import { useGetLanguage } from '@/context/i18n'
import { getLanguage } from '@/i18n-config/language'
import { useSingleCategories } from '../hooks'
import { renderI18nObject } from '@/i18n-config'
import { useMixedTranslation } from '@/app/components/plugins/marketplace/hooks'
import Partner from '../base/badges/partner'
import Verified from '../base/badges/verified'
import { RiAlertFill } from '@remixicon/react'

export type Props = {
  className?: string
  payload: Plugin
  titleLeft?: React.ReactNode
  installed?: boolean
  installFailed?: boolean
  hideCornerMark?: boolean
  descriptionLineRows?: number
  footer?: React.ReactNode
  isLoading?: boolean
  loadingFileName?: string
  locale?: string
  limitedInstall?: boolean
}

const Card = ({
  className,
  payload,
  titleLeft,
  installed,
  installFailed,
  hideCornerMark,
  descriptionLineRows = 2,
  footer,
  isLoading = false,
  loadingFileName,
  locale: localeFromProps,
  limitedInstall = false,
}: Props) => {
  const defaultLocale = useGetLanguage()
  const locale = localeFromProps ? getLanguage(localeFromProps) : defaultLocale
  const { t } = useMixedTranslation(localeFromProps)
  const { categoriesMap } = useSingleCategories(t)
  const { category, type, name, org, label, brief, icon, verified, badges = [] } = payload
  const isBundle = !['plugin', 'model', 'tool', 'datasource', 'extension', 'agent-strategy'].includes(type)
  const cornerMark = isBundle ? categoriesMap.bundle?.label : categoriesMap[category]?.label
  const getLocalizedText = (obj: Record<string, string> | undefined) =>
    obj ? renderI18nObject(obj, locale) : ''
  const isPartner = badges.includes('partner')

  const wrapClassName = cn('hover-bg-components-panel-on-panel-item-bg relative overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs', className)
  if (isLoading) {
    return (
      <Placeholder
        wrapClassName={wrapClassName}
        loadingFileName={loadingFileName!}
      />
    )
  }

  return (
    <div className={wrapClassName}>
      <div className={cn('p-4 pb-3', limitedInstall && 'pb-1')}>
        {!hideCornerMark && <CornerMark text={cornerMark} />}
        {/* Header */}
        <div className="flex">
          <Icon src={icon} installed={installed} installFailed={installFailed} />
          <div className="ml-3 w-0 grow">
            <div className="flex h-5 items-center">
              <Title title={getLocalizedText(label)} />
              {isPartner && <Partner className='ml-0.5 h-4 w-4' text={t('plugin.marketplace.partnerTip')} />}
              {verified && <Verified className='ml-0.5 h-4 w-4' text={t('plugin.marketplace.verifiedTip')} />}
              {titleLeft} {/* This can be version badge */}
            </div>
            <OrgInfo
              className="mt-0.5"
              orgName={org}
              packageName={name}
            />
          </div>
        </div>
        <Description
          className="mt-3"
          text={getLocalizedText(brief)}
          descriptionLineRows={descriptionLineRows}
        />
        {footer && <div>{footer}</div>}
      </div>
      {limitedInstall
        && <div className='relative flex h-8 items-center gap-x-2 px-3 after:absolute after:bottom-0 after:left-0 after:right-0 after:top-0 after:bg-toast-warning-bg after:opacity-40'>
          <RiAlertFill className='h-3 w-3 shrink-0 text-text-warning-secondary' />
          <p className='system-xs-regular z-10 grow text-text-secondary'>
            {t('plugin.installModal.installWarning')}
          </p>
        </div>}
    </div>
  )
}

export default React.memo(Card)
