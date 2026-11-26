'use client'

import type { ReactNode } from 'react'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useId } from 'react'
import DocLearnMoreLink from './doc-learn-more-link'

type SectionHeaderProps = {
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  titleClassName?: string
  descriptionClassName?: string
}

type InlineSectionHeaderProps = {
  title: string
  /** Lets a control be labelled by the section title. */
  titleId?: string
  tooltip?: ReactNode
  /** Appends a "Learn more" link to the tooltip. */
  docPath?: DocPathWithoutLang
  action?: ReactNode
  className?: string
}

const SectionHeader = ({
  title,
  description,
  action,
  className,
  titleClassName,
  descriptionClassName,
}: SectionHeaderProps) => {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      {/* Grow from a small basis so the description wraps beside the action instead of pushing it to a new row. */}
      <div className="min-w-0 flex-1 basis-60">
        <div className={cn('system-xl-semibold text-text-primary', titleClassName)}>{title}</div>
        {Boolean(description) && (
          <div className={cn('mt-1 system-sm-regular text-text-tertiary', descriptionClassName)}>
            {description}
          </div>
        )}
      </div>
      {action}
    </div>
  )
}

export const InlineSectionHeader = ({
  title,
  titleId,
  tooltip,
  docPath,
  action,
  className,
}: InlineSectionHeaderProps) => {
  const generatedTitleId = useId()
  const resolvedTitleId = titleId ?? generatedTitleId

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex min-h-6 items-center gap-1">
        <div id={resolvedTitleId} className="system-md-semibold text-text-primary">
          {title}
        </div>
        {Boolean(tooltip) && (
          <Infotip>
            <InfotipTrigger aria-labelledby={resolvedTitleId} />
            <InfotipContent aria-labelledby={resolvedTitleId} className="max-w-72">
              {tooltip}
              {docPath && (
                <>
                  {' '}
                  <DocLearnMoreLink path={docPath} />
                </>
              )}
            </InfotipContent>
          </Infotip>
        )}
      </div>
      {action}
    </div>
  )
}

export default SectionHeader
