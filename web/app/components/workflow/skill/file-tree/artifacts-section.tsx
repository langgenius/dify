'use client'

import type { FC } from 'react'
import { RiArrowRightSLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import FolderSpark from '@/app/components/base/icons/src/vender/workflow/FolderSpark'
import { cn } from '@/utils/classnames'

type ArtifactsSectionProps = {
  className?: string
}

/**
 * Artifacts section component for file tree.
 * Shows the artifacts folder with badge and navigation arrow.
 * Clicking expands to show artifact files from test runs.
 * Placeholder implementation - functionality to be added later.
 */
const ArtifactsSection: FC<ArtifactsSectionProps> = ({ className }) => {
  const { t } = useTranslation('workflow')
  // TODO: Replace with actual data
  const badgeText = 'Test Run#3'
  const hasNewFiles = true

  return (
    <div className={cn('shrink-0 border-t border-divider-regular p-1', className)}>
      <button
        type="button"
        className={cn(
          'flex w-full items-center rounded-md py-1 pl-2 pr-1.5',
          'hover:bg-state-base-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
        )}
        aria-label={t('skillSidebar.artifacts.openArtifacts')}
      >
        {/* Title section */}
        <div className="flex flex-1 items-center gap-1 py-0.5">
          {/* Icon */}
          <div className="flex size-5 items-center justify-center">
            <FolderSpark className="size-4 text-text-secondary" aria-hidden="true" />
          </div>
          {/* Label */}
          <span className="system-sm-semibold uppercase text-text-secondary">
            {t('skillSidebar.artifacts.title')}
          </span>
          {/* Badge */}
          <div className="flex min-w-4 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5">
            <span className="system-2xs-medium uppercase text-text-tertiary">
              {badgeText}
            </span>
          </div>
        </div>

        {/* Arrow with indicator */}
        <div className="relative">
          <RiArrowRightSLine className="size-4 text-text-tertiary" aria-hidden="true" />
          {/* Blue dot indicator */}
          {hasNewFiles && (
            <div className="absolute -right-0.5 top-1/2 size-[7px] -translate-y-1/2 rounded-full border border-white bg-state-accent-solid" />
          )}
        </div>
      </button>
    </div>
  )
}

export default React.memo(ArtifactsSection)
