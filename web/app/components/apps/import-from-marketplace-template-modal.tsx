'use client'

import type { MarketplaceTemplate } from '@/service/marketplace-templates'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { useToastContext } from '@/app/components/base/toast'
import { MARKETPLACE_API_PREFIX, MARKETPLACE_URL_PREFIX } from '@/config'
import {
  fetchMarketplaceTemplateDSL,
  useMarketplaceTemplateDetail,
} from '@/service/marketplace-templates'

type ImportFromMarketplaceTemplateModalProps = {
  templateId: string
  onConfirm: (yamlContent: string, template: MarketplaceTemplate) => void
  onClose: () => void
}

const ImportFromMarketplaceTemplateModal = ({
  templateId,
  onConfirm,
  onClose,
}: ImportFromMarketplaceTemplateModalProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()

  const { data, isLoading, isError } = useMarketplaceTemplateDetail(templateId)
  const template = data?.data ?? null

  const [isImporting, setIsImporting] = useState(false)

  const handleConfirm = useCallback(async () => {
    if (!template || isImporting)
      return
    setIsImporting(true)
    try {
      const yamlContent = await fetchMarketplaceTemplateDSL(templateId)
      onConfirm(yamlContent, template)
    }
    catch {
      notify({
        type: 'error',
        message: t('marketplace.template.importFailed', { ns: 'app' }),
      })
      setIsImporting(false)
    }
  }, [template, templateId, isImporting, onConfirm, notify, t])

  const templateUrl = MARKETPLACE_URL_PREFIX
    ? `${MARKETPLACE_URL_PREFIX}/templates/${encodeURIComponent(templateId)}`
    : undefined

  return (
    <Modal
      className="w-[520px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-xl"
      isShow
      onClose={onClose}
    >
      {/* Header */}
      <div className="flex items-start justify-between pb-3 pl-6 pr-5 pt-6">
        <div className="text-text-primary title-2xl-semi-bold">
          {t('marketplace.template.modalTitle', { ns: 'app' })}
        </div>
        <div
          className="flex h-8 w-8 cursor-pointer items-center justify-center"
          onClick={onClose}
        >
          <span className="i-ri-close-line h-[18px] w-[18px] text-text-tertiary" aria-hidden="true" />
        </div>
      </div>

      {/* Content */}
      <div className="px-6 pb-4">
        {isLoading && (
          <div className="flex h-[200px] items-center justify-center">
            <span className="i-ri-loader-2-line h-6 w-6 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        )}

        {isError && !isLoading && (
          <div className="flex h-[200px] flex-col items-center justify-center gap-2">
            <div className="text-text-tertiary system-md-regular">
              {t('marketplace.template.fetchFailed', { ns: 'app' })}
            </div>
            <Button variant="secondary" onClick={onClose}>
              {t('newApp.Cancel', { ns: 'app' })}
            </Button>
          </div>
        )}

        {template && !isLoading && (
          <div className="flex flex-col gap-4">
            {/* Template info */}
            <div className="flex items-start gap-3 rounded-xl bg-background-section-burn p-4">
              <AppIcon
                size="large"
                iconType={template.icon_file_key ? 'image' : 'emoji'}
                icon={template.icon || '🤖'}
                background={template.icon_background || '#FFEAD5'}
                imageUrl={template.icon_file_key
                  ? `${MARKETPLACE_API_PREFIX}/templates/${encodeURIComponent(templateId)}/icon`
                  : undefined}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="truncate text-text-primary system-md-semibold">
                  {template.template_name}
                </div>
                <div className="text-text-tertiary system-xs-regular">
                  {t('marketplace.template.publishedBy', { ns: 'app', publisher: template.publisher_unique_handle })}
                </div>
              </div>
            </div>

            {/* Overview */}
            {template.overview && (
              <div>
                <div className="mb-1 text-text-secondary system-sm-semibold">
                  {t('marketplace.template.overview', { ns: 'app' })}
                </div>
                <div className="line-clamp-4 text-text-tertiary system-sm-regular">
                  {template.overview}
                </div>
              </div>
            )}

            {/* Usage count */}
            {template.usage_count !== null && template.usage_count > 0 && (
              <div className="text-text-quaternary system-xs-regular">
                {t('marketplace.template.usageCount', { ns: 'app', count: template.usage_count })}
              </div>
            )}

            {/* Marketplace link */}
            {templateUrl && (
              <a
                href={templateUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-text-accent system-xs-regular"
              >
                {t('marketplace.template.viewOnMarketplace', { ns: 'app' })}
                <span className="i-ri-external-link-line h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {template && !isLoading && (
        <div className="flex items-center justify-end gap-3 border-t border-divider-subtle px-6 py-4">
          <Button variant="secondary" onClick={onClose}>
            {t('newApp.Cancel', { ns: 'app' })}
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={isImporting}
          >
            {isImporting && <span className="i-ri-loader-2-line mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('marketplace.template.importConfirm', { ns: 'app' })}
          </Button>
        </div>
      )}
    </Modal>
  )
}

export default ImportFromMarketplaceTemplateModal
