import React from 'react'
import { RiVerifiedBadgeLine } from '@remixicon/react'
import type { Plugin } from '../types'
import Icon from '../card/base/card-icon'
import CornerMark from './base/corner-mark'
import Title from './base/title'
import OrgInfo from './base/org-info'
import Description from './base/description'
import Placeholder from './base/placeholder'
import cn from '@/utils/classnames'
import type { Locale } from '@/i18n'

type Props = {
  className?: string
  payload: Plugin
  locale: Locale // The component is used in both client and server side, so we can't get the locale from both side(getLocaleOnServer and useContext)
  titleLeft?: React.ReactNode
  installed?: boolean
  hideCornerMark?: boolean
  descriptionLineRows?: number
  footer?: React.ReactNode
  serverLocale?: Locale
  isLoading?: boolean
  loadingFileName?: string
}

const Card = ({
  className,
  payload,
  titleLeft,
  installed,
  hideCornerMark,
  descriptionLineRows = 2,
  footer,
  locale,
  isLoading = false,
  loadingFileName,
}: Props) => {
  const { type, name, org, label, brief, icon } = payload

  const getLocalizedText = (obj: Record<string, string> | undefined) =>
    obj?.[locale] || obj?.['en-US'] || ''

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
      {!hideCornerMark && <CornerMark text={type} />}
      {/* Header */}
      <div className="flex">
        <Icon src={icon} installed={installed} />
        <div className="ml-3 grow">
          <div className="flex items-center h-5">
            <Title title={getLocalizedText(label)} />
            <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" />
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

export default Card
