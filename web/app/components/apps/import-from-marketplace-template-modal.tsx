'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { toast } from '@/app/notifications'
import { MARKETPLACE_API_PREFIX } from '@/config'
import {
  fetchMarketplaceTemplateDSL,
  useMarketplaceTemplateDetail,
} from '@/service/marketplace-templates'

type ImportFromMarketplaceTemplateModalProps = {
  templateId: string
  onClose: () => void
  onConfirm: (dslContent: string) => void
}

const ImportFromMarketplaceTemplateModal = ({
  templateId,
  onClose,
  onConfirm,
}: ImportFromMarketplaceTemplateModalProps) => {
  const { t } = useTranslation(['app', 'common'])
  const { data, isLoading, isError } = useMarketplaceTemplateDetail(templateId)
  const template = data?.data
  const [importing, setImporting] = useState(false)
  const isImportingRef = useRef(false)

  const CATEGORY_I18N_MAP: Record<string, string> = useMemo(
    () => ({
      marketing: t(($) => $['marketplace.template.category.marketing'], { ns: 'app' }),
      sales: t(($) => $['marketplace.template.category.sales'], { ns: 'app' }),
      support: t(($) => $['marketplace.template.category.support'], { ns: 'app' }),
      operations: t(($) => $['marketplace.template.category.operations'], { ns: 'app' }),
      it: t(($) => $['marketplace.template.category.it'], { ns: 'app' }),
      knowledge: t(($) => $['marketplace.template.category.knowledge'], { ns: 'app' }),
      design: t(($) => $['marketplace.template.category.design'], { ns: 'app' }),
    }),
    [t],
  )

  const translateCategory = useCallback(
    (slug: string) => {
      return CATEGORY_I18N_MAP[slug] ?? slug
    },
    [CATEGORY_I18N_MAP],
  )

  const handleConfirm = useCallback(async () => {
    if (isImportingRef.current) return
    isImportingRef.current = true
    setImporting(true)
    try {
      const dsl = await fetchMarketplaceTemplateDSL(templateId)
      onConfirm(dsl)
    } catch {
      toast.error(t(($) => $['marketplace.template.importFailed'], { ns: 'app' }))
    } finally {
      setImporting(false)
      isImportingRef.current = false
    }
  }, [templateId, onConfirm, t])

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-130">
        <DialogHeader>
          <DialogTitle>{t(($) => $['marketplace.template.modalTitle'], { ns: 'app' })}</DialogTitle>
          <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>

        <DialogBody aria-busy={isLoading}>
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="system-md-regular text-text-tertiary">
                {t(($) => $.loading, { ns: 'common' })}
              </div>
            </div>
          )}

          {isError && (
            <div className="flex items-center justify-center py-8" role="alert">
              <div className="system-md-regular text-text-destructive">
                {t(($) => $['marketplace.template.fetchFailed'], { ns: 'app' })}
              </div>
            </div>
          )}

          {template && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <AppIcon
                  size="large"
                  icon={{
                    icon_type: template.icon_file_key ? 'image' : 'emoji',
                    icon: template.icon || 'page_facing_up',
                    icon_url: template.icon_file_key
                      ? `${MARKETPLACE_API_PREFIX}/templates/${template.id}/icon`
                      : undefined,
                    icon_background: template.icon_file_key ? undefined : template.icon_background,
                  }}
                />
                <div className="flex flex-col">
                  <div className="system-md-semibold text-text-primary">
                    {template.template_name}
                  </div>
                  <div className="flex items-center gap-1 system-xs-regular text-text-tertiary">
                    <span>
                      {t(($) => $['marketplace.template.publishedBy'], { ns: 'app' })}{' '}
                      {template.publisher_unique_handle}
                    </span>
                    <span>·</span>
                    <span>
                      {t(($) => $['marketplace.template.usageCount'], { ns: 'app' })}{' '}
                      {template.usage_count}
                    </span>
                  </div>
                </div>
              </div>

              {template.overview && (
                <div className="flex flex-col gap-1">
                  <div className="system-xs-medium-uppercase text-text-tertiary">
                    {t(($) => $['marketplace.template.overview'], { ns: 'app' })}
                  </div>
                  <div className="system-sm-regular text-text-secondary">{template.overview}</div>
                </div>
              )}

              {template.categories.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {template.categories.map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex items-center rounded-full bg-components-label-gray px-2.5 py-1 system-sm-regular text-text-secondary"
                    >
                      {translateCategory(cat)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button onClick={onClose}>{t(($) => $['newApp.Cancel'], { ns: 'app' })}</Button>
          <Button
            variant="primary"
            disabled={isLoading || isError}
            loading={importing}
            onClick={handleConfirm}
          >
            {t(($) => $['marketplace.template.importConfirm'], { ns: 'app' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ImportFromMarketplaceTemplateModal
