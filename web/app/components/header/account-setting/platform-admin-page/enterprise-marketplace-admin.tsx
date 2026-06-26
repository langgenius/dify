'use client'

import type { EnterpriseMarketplaceAsset, EnterpriseMarketplaceAssetStatus } from '@/models/enterprise-marketplace'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { useAdminEnterpriseMarketplaceAssets, useReviewEnterpriseMarketplaceAsset, useUnlistEnterpriseMarketplaceAsset } from '@/service/use-enterprise-marketplace'
import { formatTime } from '@/utils/time'

const statusOptions: EnterpriseMarketplaceAssetStatus[] = ['pending', 'approved', 'rejected', 'unlisted']

type ReviewDialogProps = {
  asset: EnterpriseMarketplaceAsset | null
  action: 'approved' | 'rejected' | null
  loading: boolean
  onClose: () => void
  onSubmit: (reviewNote: string) => void
}

const ReviewDialog = ({
  asset,
  action,
  loading,
  onClose,
  onSubmit,
}: ReviewDialogProps) => {
  const { t } = useTranslation()
  const [reviewNote, setReviewNote] = useState(asset?.review_note || '')

  if (!asset || !action)
    return null

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[560px] p-0">
        <div className="p-6 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {action === 'approved'
              ? t('enterpriseMarketplace.approveAction', { ns: 'common' })
              : t('enterpriseMarketplace.rejectAction', { ns: 'common' })}
          </DialogTitle>
        </div>
        <div className="space-y-3 px-6 pb-4">
          <div className="rounded-xl border border-divider-subtle bg-background-body p-4">
            <div className="system-sm-semibold text-text-primary">{asset.title}</div>
            <div className="mt-1 system-xs-regular text-text-tertiary">
              {asset.source_workspace_name || t('enterpriseMarketplace.hiddenWorkspace', { ns: 'common' })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm text-text-secondary">
              {t('enterpriseMarketplace.reviewNoteLabel', { ns: 'common' })}
            </div>
            <Textarea
              value={reviewNote}
              onValueChange={setReviewNote}
              placeholder={t('enterpriseMarketplace.reviewNotePlaceholder', { ns: 'common' })}
              maxLength={5000}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-divider-subtle px-6 py-4">
          <Button onClick={onClose}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button variant="primary" loading={loading} onClick={() => onSubmit(reviewNote.trim())}>
            {action === 'approved'
              ? t('enterpriseMarketplace.approveAction', { ns: 'common' })
              : t('enterpriseMarketplace.rejectAction', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const EnterpriseMarketplaceAdmin = () => {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const deferredKeyword = useDeferredValue(keyword)
  const [status, setStatus] = useState<EnterpriseMarketplaceAssetStatus>('pending')
  const [page, setPage] = useState(1)
  const [selectedAsset, setSelectedAsset] = useState<EnterpriseMarketplaceAsset | null>(null)
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected' | null>(null)

  const assetQuery = useAdminEnterpriseMarketplaceAssets({ keyword: deferredKeyword, status, page })
  const reviewMutation = useReviewEnterpriseMarketplaceAsset()
  const unlistMutation = useUnlistEnterpriseMarketplaceAsset()

  const items = useMemo(() => assetQuery.data?.items || [], [assetQuery.data?.items])
  const total = assetQuery.data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / 50))
  const reviewableAssets = useMemo(() => items.filter(item => item.status === 'pending'), [items])

  const handleUnlist = (assetId: string) => {
    unlistMutation.mutate(assetId, {
      onSuccess: () => toast.success(t('enterpriseMarketplace.unlistSuccess', { ns: 'common' })),
      onError: error => toast.error(error instanceof Error ? error.message : t('api.actionFailed', { ns: 'common' })),
    })
  }

  const handleReviewSubmit = (reviewNote: string) => {
    if (!selectedAsset || !reviewAction)
      return

    reviewMutation.mutate({
      assetId: selectedAsset.id,
      status: reviewAction,
      review_note: reviewNote || undefined,
    }, {
      onSuccess: () => {
        toast.success(
          reviewAction === 'approved'
            ? t('enterpriseMarketplace.approveSuccess', { ns: 'common' })
            : t('enterpriseMarketplace.rejectSuccess', { ns: 'common' }),
        )
        setSelectedAsset(null)
        setReviewAction(null)
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t('api.actionFailed', { ns: 'common' }))
      },
    })
  }

  return (
    <>
      <div className="rounded-2xl border border-divider-subtle bg-components-panel-bg p-4">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="title-md-semi-bold text-text-primary">
              {t('enterpriseMarketplace.adminSectionTitle', { ns: 'common' })}
            </div>
            <div className="mt-1 system-xs-regular text-text-tertiary">
              {t('enterpriseMarketplace.adminSectionTip', { ns: 'common' })}
            </div>
          </div>
          <SearchInput className="lg:w-[240px]" value={keyword} onValueChange={setKeyword} />
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {statusOptions.map(option => (
            <button
              key={option}
              type="button"
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm',
                option === status
                  ? 'border-components-button-primary-border bg-state-base-hover text-text-primary'
                  : 'border-divider-subtle text-text-tertiary hover:bg-state-base-hover',
              )}
              onClick={() => setStatus(option)}
            >
              {t(`enterpriseMarketplace.status.${option}`, { ns: 'common' })}
            </button>
          ))}
        </div>

        {status === 'pending' && reviewableAssets.length > 0 && (
          <div className="mb-4 rounded-xl border border-divider-subtle bg-background-body px-4 py-3 system-sm-regular text-text-secondary">
            {t('enterpriseMarketplace.pendingSummary', { ns: 'common', count: reviewableAssets.length })}
          </div>
        )}

        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="rounded-2xl border border-divider-subtle bg-background-body p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate title-md-semi-bold text-text-primary">{item.title}</div>
                    <span className="rounded-full bg-background-default px-2 py-1 system-2xs-medium-uppercase text-text-tertiary">
                      {t(`enterpriseMarketplace.status.${item.status}`, { ns: 'common' })}
                    </span>
                    <span className="rounded-full bg-background-default px-2 py-1 system-2xs-medium-uppercase text-text-tertiary">
                      {item.category}
                    </span>
                  </div>
                  <div className="mt-2 system-sm-regular text-text-tertiary">
                    {item.source_workspace_name || t('enterpriseMarketplace.hiddenWorkspace', { ns: 'common' })}
                    {' · '}
                    {item.submitter_name || t('account.account', { ns: 'common' })}
                    {' · '}
                    {formatTime({ date: item.updated_at * 1000, dateFormat: t('segment.dateTimeFormat', { ns: 'datasetDocuments' }) })}
                  </div>
                  <div className="mt-3 system-sm-regular text-text-secondary">{item.description || item.app_description}</div>
                  {!!item.scenario && (
                    <div className="mt-3 rounded-xl border border-divider-subtle bg-components-panel-bg p-3 system-xs-regular text-text-tertiary">
                      {item.scenario}
                    </div>
                  )}
                  {!!item.review_note && (
                    <div className="mt-3 system-xs-regular text-text-tertiary">
                      {t('enterpriseMarketplace.reviewNoteLabel', { ns: 'common' })}
                      {': '}
                      {item.review_note}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {item.status === 'pending' && (
                    <>
                      <Button
                        size="small"
                        onClick={() => {
                          setSelectedAsset(item)
                          setReviewAction('rejected')
                        }}
                      >
                        {t('enterpriseMarketplace.rejectAction', { ns: 'common' })}
                      </Button>
                      <Button
                        variant="primary"
                        size="small"
                        onClick={() => {
                          setSelectedAsset(item)
                          setReviewAction('approved')
                        }}
                      >
                        {t('enterpriseMarketplace.approveAction', { ns: 'common' })}
                      </Button>
                    </>
                  )}
                  {item.status === 'approved' && (
                    <Button
                      size="small"
                      onClick={() => handleUnlist(item.id)}
                    >
                      {t('enterpriseMarketplace.unlistAction', { ns: 'common' })}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {!assetQuery.isLoading && !items.length && (
            <div className="rounded-2xl border border-dashed border-divider-subtle px-4 py-10 text-center system-sm-regular text-text-tertiary">
              {t('enterpriseMarketplace.emptyAdmin', { ns: 'common' })}
            </div>
          )}
        </div>

        {!assetQuery.isLoading && total > 0 && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="system-sm-regular text-text-tertiary">
              {t('enterpriseMarketplace.pageInfo', { ns: 'common', current: page, total: totalPages })}
            </div>
            <div className="flex items-center gap-2">
              <Button size="small" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>
                {t('enterpriseMarketplace.previousPage', { ns: 'common' })}
              </Button>
              <Button size="small" disabled={page >= totalPages} onClick={() => setPage(current => current + 1)}>
                {t('enterpriseMarketplace.nextPage', { ns: 'common' })}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ReviewDialog
        key={`${selectedAsset?.id || 'empty'}-${reviewAction || 'none'}`}
        asset={selectedAsset}
        action={reviewAction}
        loading={reviewMutation.isPending}
        onClose={() => {
          setSelectedAsset(null)
          setReviewAction(null)
        }}
        onSubmit={handleReviewSubmit}
      />
    </>
  )
}

export default EnterpriseMarketplaceAdmin
