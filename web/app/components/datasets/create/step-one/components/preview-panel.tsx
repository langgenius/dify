'use client'

import type { NotionPage } from '@/models/common'
import type { CrawlResultItem } from '@/models/datasets'
import { useTranslation } from 'react-i18next'
import PlanUpgradeModal from '@/app/components/billing/plan-upgrade-modal'
import FilePreview from '../../file-preview'
import NotionPagePreview from '../../notion-page-preview'
import WebsitePreview from '../../website/preview'

type PreviewPanelProps = {
  currentFile: File | undefined
  currentNotionPage: NotionPage | undefined
  currentWebsite: CrawlResultItem | undefined
  notionCredentialId: string
  isShowPlanUpgradeModal: boolean
  hideFilePreview: () => void
  hideNotionPagePreview: () => void
  hideWebsitePreview: () => void
  hidePlanUpgradeModal: () => void
}

/**
 * Right panel component for displaying file, notion page, or website previews.
 */
function PreviewPanel({
  currentFile,
  currentNotionPage,
  currentWebsite,
  notionCredentialId,
  isShowPlanUpgradeModal,
  hideFilePreview,
  hideNotionPagePreview,
  hideWebsitePreview,
  hidePlanUpgradeModal,
}: PreviewPanelProps) {
  const { t } = useTranslation()

  return (
    <div className="h-full w-1/2 overflow-y-auto">
      {currentFile && <FilePreview file={currentFile} hidePreview={hideFilePreview} />}
      {currentNotionPage && (
        <NotionPagePreview
          currentPage={currentNotionPage}
          hidePreview={hideNotionPagePreview}
          notionCredentialId={notionCredentialId}
        />
      )}
      {currentWebsite && <WebsitePreview payload={currentWebsite} hidePreview={hideWebsitePreview} />}
      {isShowPlanUpgradeModal && (
        <PlanUpgradeModal
          show
          onClose={hidePlanUpgradeModal}
          title={t('upgrade.uploadMultiplePages.title', { ns: 'billing' })!}
          description={t('upgrade.uploadMultiplePages.description', { ns: 'billing' })!}
        />
      )}
    </div>
  )
}

export default PreviewPanel
