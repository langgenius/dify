import React, { useMemo } from 'react'
import { RiVerifiedBadgeLine } from '@remixicon/react'
import type { FC } from 'react'
import { LeftCorner } from '../base/icons/src/vender/plugin'
import type { Plugin } from './types'
import { getLocaleOnServer } from '@/i18n/server'
import cn from '@/utils/classnames'

export const CornerMark = ({ text }: { text: string }) => {
  return (
    <div className='absolute top-0 right-0 flex pl-[13px] '>
      <LeftCorner className="text-background-section" />
      <div className="h-5 leading-5 rounded-tr-xl pr-2 bg-background-section text-text-tertiary system-2xs-medium-uppercase">{text}</div>
    </div>
  )
}

export const Icon = ({
  className,
  src,
  installed = false,
}: {
  className?: string
  src: string
  installed?: boolean
}) => {
  return (
    <div
      className={cn('shrink-0 relative w-10 h-10 rounded-md bg-center bg-no-repeat bg-contain', className)}
      style={{
        backgroundImage: `url(${src})`,
      }}
    >
    </div>
  )
}

export const Title = ({
  title,
}: {
  title: string
}) => {
  return (
    <div className='max-w-[150px] truncate text-text-secondary system-md-semibold'>
      {title}
    </div>
  )
}

export const OrgInfo = ({
  className,
  orgName,
  packageName,
}: {
  className?: string
  orgName: string
  packageName: string
}) => {
  return <div className={cn('flex items-center h-4 space-x-0.5', className)}>
    <span className="shrink-0 text-text-tertiary system-xs-regular">{orgName}</span>
    <span className='shrink-0 text-text-quaternary system-xs-regular'>/</span>
    <span className="shrink-0 w-0 grow truncate text-text-tertiary system-xs-regular">{packageName}</span>
  </div>
}

type DescriptionProps = {
  className?: string
  text: string
  descriptionLineRows: number
}

const Description: FC<DescriptionProps> = ({
  className,
  text,
  descriptionLineRows,
}) => {
  const lineClassName = useMemo(() => {
    if (descriptionLineRows === 1)
      return 'truncate'
    else if (descriptionLineRows === 2)
      return 'line-clamp-2'
    else
      return 'line-clamp-3'
  }, [descriptionLineRows])
  return (
    <div className={cn('text-text-tertiary system-xs-regular', lineClassName, className)}>
      {text}
    </div>
  )
}

type Props = {
  className?: string
  payload: Plugin
  installed?: boolean
  descriptionLineRows?: number
  footer?: React.ReactNode
}

const Card = ({
  className,
  payload,
  installed,
  descriptionLineRows = 2,
  footer,
}: Props) => {
  const locale = getLocaleOnServer()

  const { type, name, org, label } = payload
  return (
    <div className={cn('relative p-4 pb-3 border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg rounded-xl shadow-xs')}>
      <CornerMark text={type} />
      {/* Header */}
      <div className="flex">
        <Icon src={payload.icon} installed={installed} />
        <div className="ml-3 grow">
          <div className="flex items-center h-5">
            <Title title={label[locale]} />
            <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" />
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
