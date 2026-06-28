import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import CornerLabel from '@/app/components/base/corner-label'
import Link from '@/next/link'

type VisualStyle = 'default' | 'compact' | 'list'

type BaseProps = {
  badge?: string
  badgeVariant?: 'basic' | 'advanced'
  stepByStepTourTarget?: string
  description: string
  icon: ReactNode
  title: string
  visualStyle?: VisualStyle
}

type ButtonActionCardProps = BaseProps & {
  href?: never
  onClick: () => void
}

type LinkActionCardProps = BaseProps & {
  href: string
  onClick?: never
}

type FirstEmptyActionCardProps = ButtonActionCardProps | LinkActionCardProps

const baseCardClassName = 'relative flex rounded-xl bg-components-button-secondary-bg text-left shadow-xs transition-colors hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden'
const compactBadgeClassName = {
  basic: {
    corner: 'text-util-colors-orange-orange-50',
    label: 'bg-util-colors-orange-orange-50',
    text: 'text-util-colors-orange-orange-600',
  },
  advanced: {
    corner: 'text-components-dropzone-bg-accent',
    label: 'bg-components-dropzone-bg-accent',
    text: 'text-components-premium-badge-blue-bg-stop-100',
  },
}

function CompactBadge({
  badge,
  badgeVariant,
}: {
  badge: string
  badgeVariant: 'basic' | 'advanced'
}) {
  return (
    <CornerLabel
      label={badge}
      className="absolute top-0 right-0 z-5"
      cornerClassName={compactBadgeClassName[badgeVariant].corner}
      labelClassName={cn('rounded-tr-xl pr-2', compactBadgeClassName[badgeVariant].label)}
      textClassName={compactBadgeClassName[badgeVariant].text}
    />
  )
}

function ActionCardContent({
  badge,
  badgeVariant = 'basic',
  description,
  icon,
  title,
  visualStyle = 'default',
}: BaseProps) {
  if (visualStyle === 'list') {
    return (
      <>
        {badge && (
          <CornerLabel
            label={badge}
            className="absolute top-0 right-0 z-5"
            cornerClassName="text-util-colors-indigo-indigo-100"
            labelClassName="-ml-px rounded-tr-xl bg-util-colors-indigo-indigo-100 pr-2"
            textClassName="text-util-colors-indigo-indigo-700"
          />
        )}
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-section text-text-tertiary">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate system-md-medium text-text-secondary" title={title}>{title}</span>
          <span className="truncate system-xs-regular text-text-tertiary" title={description}>{description}</span>
        </span>
      </>
    )
  }

  const isCompact = visualStyle === 'compact'
  const badgeNode = badge
    ? isCompact
      ? <CompactBadge badge={badge} badgeVariant={badgeVariant} />
      : (
          <span className="absolute top-4 right-4 flex min-w-[18px] items-center justify-center gap-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px] system-2xs-medium-uppercase text-text-tertiary">
            {badge}
          </span>
        )
    : null

  return (
    <>
      {badgeNode}
      <span className={`${isCompact ? 'size-10 rounded-lg border border-divider-regular text-2xl/7' : 'size-12 rounded-xl text-2xl/8'} flex items-center justify-center bg-components-icon-bg-teal-soft text-text-accent`}>
        {icon}
      </span>
      <span className={`${isCompact ? 'mt-1 system-md-semibold text-text-secondary' : 'mt-5 system-md-semibold text-text-primary'} w-full truncate`} title={title}>{title}</span>
      <span className={`${isCompact ? 'mt-3 line-clamp-3 system-xs-regular' : 'mt-2 system-sm-regular'} text-text-tertiary`} title={description}>{description}</span>
    </>
  )
}

function FirstEmptyActionCard(props: FirstEmptyActionCardProps) {
  const className = cn(
    baseCardClassName,
    props.visualStyle === 'list'
      ? 'w-full items-center gap-3 overflow-hidden px-3 py-2.5 backdrop-blur-md'
      : 'flex-col border border-components-panel-border bg-components-panel-on-panel-item-bg hover:shadow-sm',
    props.visualStyle === 'compact'
      ? 'min-h-[156px] overflow-hidden px-4 pt-6 pb-3'
      : props.visualStyle === 'list'
        ? undefined
        : 'min-h-[204px] p-6',
  )

  if (props.href) {
    return (
      <Link href={props.href} className={className} data-step-by-step-tour-target={props.stepByStepTourTarget}>
        <ActionCardContent
          badge={props.badge}
          badgeVariant={props.badgeVariant}
          description={props.description}
          icon={props.icon}
          title={props.title}
          visualStyle={props.visualStyle}
        />
      </Link>
    )
  }

  return (
    <button type="button" className={className} data-step-by-step-tour-target={props.stepByStepTourTarget} onClick={props.onClick}>
      <ActionCardContent
        badge={props.badge}
        badgeVariant={props.badgeVariant}
        description={props.description}
        icon={props.icon}
        title={props.title}
        visualStyle={props.visualStyle}
      />
    </button>
  )
}

export default FirstEmptyActionCard
