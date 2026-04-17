'use client'
import type { CrawlResultItem } from '@/models/datasets'
import { RiCloseLine, RiGlobalLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { formatNumberAbbreviated } from '@/utils/format'

type WebsitePreviewProps = {
  currentWebsite: CrawlResultItem
  hidePreview: () => void
}

const WebsitePreview = ({
  currentWebsite,
  hidePreview,
}: WebsitePreviewProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex h-full w-full flex-col rounded-t-xl border-t border-l border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5">
      <div className="flex gap-x-2 border-b border-divider-subtle pt-4 pr-4 pb-3 pl-6">
        <div className="flex grow flex-col gap-y-1">
          <div className="system-2xs-semibold-uppercase">{t('addDocuments.stepOne.preview', { ns: 'datasetPipeline' })}</div>
          <div className="text-tex-primary title-md-semi-bold">{currentWebsite.title}</div>
          <div className="flex gap-x-1 system-xs-medium text-text-tertiary">
            <RiGlobalLine className="size-3.5" />
            <span className="uppercase" title={currentWebsite.source_url}>{currentWebsite.source_url}</span>
            <span>·</span>
            <span>·</span>
            <span>{`${formatNumberAbbreviated(currentWebsite.markdown.length)} ${t('addDocuments.characters', { ns: 'datasetPipeline' })}`}</span>
          </div>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center"
          onClick={hidePreview}
        >
          <RiCloseLine className="size-[18px]" />
        </button>
      </div>
      <div className="grow overflow-hidden px-6 py-5 body-md-regular text-text-secondary">
        {currentWebsite.markdown}
      </div>
    </div>
  )
}

export default WebsitePreview
