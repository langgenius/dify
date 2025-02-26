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
import { getLanguage } from '@/i18n/language'
import { useSingleCategories } from '../hooks'
import { renderI18nObject } from '@/hooks/use-i18n'
import { useMixedTranslation } from '@/app/components/plugins/marketplace/hooks'
import Partner from '../base/badges/partner'
import Verified from '../base/badges/verified'

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
}: Props) => {
  const defaultLocale = useGetLanguage()
  const locale = localeFromProps ? getLanguage(localeFromProps) : defaultLocale
  const { t } = useMixedTranslation(localeFromProps)
  const { categoriesMap } = useSingleCategories(t)
  const { category, type, name, org, label, brief, icon, verified, badges = [] } = payload
  const isBundle = !['plugin', 'model', 'tool', 'extension', 'agent-strategy'].includes(type)
  const cornerMark = isBundle ? categoriesMap.bundle?.label : categoriesMap[category]?.label
  const getLocalizedText = (obj: Record<string, string> | undefined) =>
    obj ? renderI18nObject(obj, locale) : ''
  const isPartner = badges.includes('partner')

  const wrapClassName = cn('relative p-4 pb-3 border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg rounded-xl shadow-xs', className)
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
      {!hideCornerMark && <CornerMark text={cornerMark} />}
      {/* Header */}
      <div className="flex">
        <Icon src={icon} installed={installed} installFailed={installFailed} />
        <div className="ml-3 w-0 grow">
          <div className="flex items-center h-5">
            <Title title={getLocalizedText(label)} />
            {isPartner && <Partner className='w-4 h-4 ml-0.5' text={t('plugin.marketplace.partnerTip')} />}
            {verified && <Verified className='w-4 h-4 ml-0.5' text={t('plugin.marketplace.verifiedTip')} />}
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
  )
}

export default React.memo(Card)
