import React from 'react'
import { RiVerifiedBadgeLine } from '@remixicon/react'
import type { Plugin } from '../types'
import Badge from '../../base/badge'
import CornerMark from './base/corner-mark'
import Icon from './base/icon'
import Title from './base/title'
import OrgInfo from './base/org-info'
import Description from './base/description'
import cn from '@/utils/classnames'
import { getLocaleOnServer } from '@/i18n/server'

type Props = {
  className?: string
  payload: Plugin
  showVersion?: boolean
  installed?: boolean
  descriptionLineRows?: number
  footer?: React.ReactNode
}

const Card = ({
  className,
  payload,
  showVersion,
  installed,
  descriptionLineRows = 2,
  footer,
}: Props) => {
  const locale = getLocaleOnServer()
  const { type, name, org, label } = payload

  return (
    <div className={cn('relative p-4 pb-3 border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg rounded-xl shadow-xs', className)}>
      <CornerMark text={type} />
      {/* Header */}
      <div className="flex">
        <Icon src={payload.icon} installed={installed} />
        <div className="ml-3 grow">
          <div className="flex items-center h-5">
            <Title title={label[locale]} />
            <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" />
            {
              showVersion && <Badge className='ml-1' text={payload.latest_version} />
            }
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
        text={payload.brief[locale]}
        descriptionLineRows={descriptionLineRows}
      />
      {footer && <div>{footer}</div>}
    </div>
  )
}

export default Card
