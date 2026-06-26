'use client'

import type { EnterpriseMarketplaceAsset } from '@/models/enterprise-marketplace'
import type { AppIconType, AppModeEnum } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DSLConfirmModal from '@/app/components/app/create-from-dsl-modal/dsl-confirm-modal'
import { useSetNeedRefreshAppList } from '@/app/components/apps/storage'
import AppIcon from '@/app/components/base/app-icon'
import { SearchInput } from '@/app/components/base/search-input'
import { useAppContext } from '@/context/app-context'
import { DSLImportStatus } from '@/models/app'
import { useRouter } from '@/next/navigation'
import { importDSLConfirm } from '@/service/apps'
import { useEnterpriseMarketplaceMySubmissions, useEnterpriseMarketplacePublicAssets, useUseEnterpriseMarketplaceAsset } from '@/service/use-enterprise-marketplace'
import { getRedirection } from '@/utils/app-redirection'

type MarketplaceCopyState = 'idle' | 'submitting' | 'awaiting_confirm' | 'confirming' | 'completed' | 'failed'
type MarketplaceCopyErrorType = 'start' | 'confirm' | null

type MarketplaceCopyFlow = {
  assetId: string | null
  state: MarketplaceCopyState
  errorType: MarketplaceCopyErrorType
  errorMessage: string | null
}

const defaultCopyFlow: MarketplaceCopyFlow = {
  assetId: null,
  state: 'idle',
  errorType: null,
  errorMessage: null,
}

const getFriendlyErrorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof Error))
    return fallback

  const normalizedMessage = error.message.trim()
  if (!normalizedMessage)
    return fallback

  const genericMessages = new Set([
    'Internal Server Error',
    'Failed to fetch',
    'Network Error',
  ])

  if (genericMessages.has(normalizedMessage))
    return fallback

  return normalizedMessage.length > 160 ? fallback : normalizedMessage
}

const AssetDetailDialog = ({
  asset,
  open,
  canUse,
  copyState,
  copyErrorMessage,
  closeDisabled,
  primaryDisabled,
  onClose,
  onUse,
}: {
  asset: EnterpriseMarketplaceAsset | null
  open: boolean
  canUse: boolean
  copyState: MarketplaceCopyState
  copyErrorMessage?: string | null
  closeDisabled: boolean
  primaryDisabled: boolean
  onClose: () => void
  onUse: () => void
}) => {
  const { t } = useTranslation()

  if (!asset)
    return null

  const statusTone = {
    idle: '',
    submitting: 'border-divider-subtle bg-state-base-hover text-text-primary',
    awaiting_confirm: 'border-divider-subtle bg-components-panel-bg text-text-primary',
    confirming: 'border-divider-subtle bg-state-base-hover text-text-primary',
    completed: 'border-divider-subtle bg-components-panel-bg text-text-primary',
    failed: 'border-divider-subtle bg-state-base-hover text-text-warning-secondary',
  }[copyState]

  const statusTitle = {
    idle: '',
    submitting: t('enterpriseMarketplace.statusLabel.submitting', { ns: 'common' }),
    awaiting_confirm: t('enterpriseMarketplace.statusLabel.awaitingConfirm', { ns: 'common' }),
    confirming: t('enterpriseMarketplace.statusLabel.confirming', { ns: 'common' }),
    completed: t('enterpriseMarketplace.statusLabel.completed', { ns: 'common' }),
    failed: t('enterpriseMarketplace.statusLabel.failed', { ns: 'common' }),
  }[copyState]

  const statusDescription = {
    idle: '',
    submitting: t('enterpriseMarketplace.statusHint.submitting', { ns: 'common' }),
    awaiting_confirm: t('enterpriseMarketplace.statusHint.awaitingConfirm', { ns: 'common' }),
    confirming: t('enterpriseMarketplace.statusHint.confirming', { ns: 'common' }),
    completed: t('enterpriseMarketplace.statusHint.completed', { ns: 'common' }),
    failed: copyErrorMessage || t('enterpriseMarketplace.statusHint.retry', { ns: 'common' }),
  }[copyState]

  const primaryLabel = {
    idle: t('enterpriseMarketplace.useAction', { ns: 'common' }),
    submitting: t('enterpriseMarketplace.useActionSubmitting', { ns: 'common' }),
    awaiting_confirm: t('enterpriseMarketplace.useActionAwaitingConfirm', { ns: 'common' }),
    confirming: t('enterpriseMarketplace.useActionConfirming', { ns: 'common' }),
    completed: t('enterpriseMarketplace.useActionCompleted', { ns: 'common' }),
    failed: t('enterpriseMarketplace.useActionRetry', { ns: 'common' }),
  }[copyState]

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !closeDisabled)
          onClose()
      }}
    >
      <DialogContent className="max-w-[720px] p-0">
        <div className="border-b border-divider-subtle p-6 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">{asset.title}</DialogTitle>
          <div className="mt-2 system-sm-regular text-text-tertiary">
            {asset.source_workspace_name || t('enterpriseMarketplace.hiddenWorkspace', { ns: 'common' })}
            {' · '}
            {asset.category}
          </div>
        </div>
        <div className="space-y-4 px-6 py-4">
          <div className="system-md-regular text-text-secondary">{asset.description || asset.app_description}</div>
          {!!asset.scenario && (
            <div className="rounded-2xl border border-divider-subtle bg-background-body p-4">
              <div className="mb-2 system-sm-semibold text-text-primary">
                {t('enterpriseMarketplace.scenarioLabel', { ns: 'common' })}
              </div>
              <div className="system-sm-regular text-text-tertiary">{asset.scenario}</div>
            </div>
          )}
          {!!asset.tags.length && (
            <div className="flex flex-wrap gap-2">
              {asset.tags.map(tag => (
                <span key={tag} className="rounded-full bg-background-default px-3 py-1 system-xs-medium-uppercase text-text-tertiary">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        {copyState !== 'idle' && (
          <div className="px-6">
            <div className={cn('rounded-2xl border px-4 py-3', statusTone)}>
              <div className="system-sm-semibold">{statusTitle}</div>
              <div className="mt-1 system-sm-regular">{statusDescription}</div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-divider-subtle px-6 py-4">
          <Button disabled={closeDisabled} onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
          <Button
            variant="primary"
            loading={copyState === 'submitting' || copyState === 'confirming'}
            disabled={!canUse || primaryDisabled}
            onClick={onUse}
          >
            {primaryLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const EnterpriseMarketplace = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { push } = useRouter()
  const setNeedRefresh = useSetNeedRefreshAppList()
  const [keyword, setKeyword] = useState('')
  const deferredKeyword = useDeferredValue(keyword)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [selectedAsset, setSelectedAsset] = useState<EnterpriseMarketplaceAsset | null>(null)
  const [showDSLConfirmModal, setShowDSLConfirmModal] = useState(false)
  const [pendingVersions, setPendingVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const [copyFlow, setCopyFlow] = useState<MarketplaceCopyFlow>(defaultCopyFlow)
  const pendingImportIdRef = useRef('')
  const pendingAssetIdRef = useRef('')

  const publicAssetQuery = useEnterpriseMarketplacePublicAssets({
    keyword: deferredKeyword,
    category: selectedCategory === 'all' ? undefined : selectedCategory,
    page,
    limit: 24,
  })
  const mySubmissionQuery = useEnterpriseMarketplaceMySubmissions()
  const useAssetMutation = useUseEnterpriseMarketplaceAsset()

  const allAssets = useMemo(() => publicAssetQuery.data?.items || [], [publicAssetQuery.data?.items])
  const categories = useMemo(() => Array.from(new Set(allAssets.map(item => item.category))), [allAssets])
  const visibleAssets = allAssets
  const total = publicAssetQuery.data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / 24))
  const selectedAssetCopyState = selectedAsset && copyFlow.assetId === selectedAsset.id ? copyFlow.state : 'idle'
  const selectedAssetErrorMessage = selectedAsset && copyFlow.assetId === selectedAsset.id ? copyFlow.errorMessage : null
  const isCloseDisabled = selectedAssetCopyState === 'submitting' || selectedAssetCopyState === 'confirming'
  const isPrimaryDisabled = selectedAssetCopyState === 'submitting' || selectedAssetCopyState === 'confirming' || selectedAssetCopyState === 'completed'

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden border-l-[0.5px] border-divider-regular">
        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="sticky top-0 z-10 bg-background-body px-12 pt-6 pb-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="system-xl-semibold text-text-primary">
                  {t('enterpriseMarketplace.pageTitle', { ns: 'common' })}
                </div>
                <div className="mt-1 system-sm-regular text-text-tertiary">
                  {t('enterpriseMarketplace.pageSubtitle', { ns: 'common' })}
                </div>
              </div>
              <SearchInput
                className="w-full lg:w-[240px]"
                value={keyword}
                onValueChange={setKeyword}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm',
                  selectedCategory === 'all'
                    ? 'border-components-button-primary-border bg-state-base-hover text-text-primary'
                    : 'border-divider-subtle text-text-tertiary hover:bg-state-base-hover',
                )}
                onClick={() => setSelectedCategory('all')}
              >
                {t('enterpriseMarketplace.allCategories', { ns: 'common' })}
              </button>
              {categories.map(category => (
                <button
                  key={category}
                  type="button"
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm',
                    selectedCategory === category
                      ? 'border-components-button-primary-border bg-state-base-hover text-text-primary'
                      : 'border-divider-subtle text-text-tertiary hover:bg-state-base-hover',
                  )}
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          {!!mySubmissionQuery.data?.items.length && (
            <div className="px-12 pb-2">
              <div className="rounded-2xl border border-divider-subtle bg-components-panel-bg p-4">
                <div className="mb-3 title-md-semi-bold text-text-primary">
                  {t('enterpriseMarketplace.mySubmissions', { ns: 'common' })}
                </div>
                <div className="space-y-2">
                  {mySubmissionQuery.data.items.slice(0, 3).map(item => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background-body px-4 py-3">
                      <div>
                        <div className="system-sm-semibold text-text-primary">{item.title}</div>
                        <div className="mt-1 system-xs-regular text-text-tertiary">
                          {t(`enterpriseMarketplace.status.${item.status}`, { ns: 'common' })}
                        </div>
                      </div>
                      {!!item.review_note && (
                        <div className="max-w-[480px] system-xs-regular text-text-tertiary">{item.review_note}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 px-12 pt-4 pb-8 xl:grid-cols-2 2xl:grid-cols-3">
            {visibleAssets.map(asset => (
              <button
                key={asset.id}
                type="button"
                className="flex min-h-[220px] flex-col rounded-2xl border border-components-panel-border bg-components-panel-on-panel-item-bg p-5 text-left shadow-sm transition-all duration-200 hover:shadow-lg"
                onClick={() => setSelectedAsset(asset)}
              >
                <div className="flex items-start gap-3">
                  <AppIcon
                    size="large"
                    iconType={asset.app_icon_type as AppIconType | null}
                    icon={asset.app_icon || ''}
                    background={asset.app_icon_background || '#FFFFFF'}
                  />
                  <div className="min-w-0">
                    <div className="truncate title-md-semi-bold text-text-primary">{asset.title}</div>
                    <div className="mt-1 system-xs-regular text-text-tertiary">
                      {asset.source_workspace_name || t('enterpriseMarketplace.hiddenWorkspace', { ns: 'common' })}
                    </div>
                  </div>
                </div>
                <div className="mt-4 line-clamp-4 system-sm-regular text-text-secondary">
                  {asset.description || asset.app_description}
                </div>
                <div className="mt-auto pt-4">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-background-default px-3 py-1 system-2xs-medium-uppercase text-text-tertiary">
                      {asset.category}
                    </span>
                    <span className="rounded-full bg-background-default px-3 py-1 system-2xs-medium-uppercase text-text-tertiary">
                      {asset.app_mode}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {!publicAssetQuery.isLoading && total > 0 && (
            <div className="flex items-center justify-between gap-3 px-12 pb-10">
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

          {!publicAssetQuery.isLoading && !visibleAssets.length && (
            <div className="px-12 pb-10">
              <div className="rounded-2xl border border-dashed border-divider-subtle px-4 py-10 text-center system-sm-regular text-text-tertiary">
                {t('enterpriseMarketplace.emptyPublic', { ns: 'common' })}
              </div>
            </div>
          )}
        </div>
      </div>

      <AssetDetailDialog
        asset={selectedAsset}
        open={!!selectedAsset}
        canUse={isCurrentWorkspaceEditor}
        copyState={selectedAssetCopyState}
        copyErrorMessage={selectedAssetErrorMessage}
        closeDisabled={isCloseDisabled}
        primaryDisabled={isPrimaryDisabled}
        onClose={() => setSelectedAsset(null)}
        onUse={() => {
          if (!selectedAsset)
            return

          if (selectedAssetCopyState === 'submitting' || selectedAssetCopyState === 'confirming' || selectedAssetCopyState === 'completed')
            return

          if (pendingImportIdRef.current && pendingAssetIdRef.current === selectedAsset.id) {
            setCopyFlow({
              assetId: selectedAsset.id,
              state: 'awaiting_confirm',
              errorType: null,
              errorMessage: null,
            })
            setShowDSLConfirmModal(true)
            return
          }

          setCopyFlow({
            assetId: selectedAsset.id,
            state: 'submitting',
            errorType: null,
            errorMessage: null,
          })
          useAssetMutation.mutate(selectedAsset.id, {
            onSuccess: (response) => {
              const leakedDependencies = response.leaked_dependencies || []
              if (
                response.import_result.status === DSLImportStatus.PENDING
                && response.import_result.id
              ) {
                pendingImportIdRef.current = response.import_result.id
                pendingAssetIdRef.current = selectedAsset.id
                setPendingVersions({
                  importedVersion: response.import_result.imported_dsl_version || '',
                  systemVersion: response.import_result.current_dsl_version || '',
                })
                setCopyFlow({
                  assetId: selectedAsset.id,
                  state: 'awaiting_confirm',
                  errorType: null,
                  errorMessage: null,
                })
                setShowDSLConfirmModal(true)
                toast.info(t('enterpriseMarketplace.usePending', { ns: 'common' }))
                return
              }

              if (response.import_result.app_id) {
                setCopyFlow({
                  assetId: selectedAsset.id,
                  state: 'completed',
                  errorType: null,
                  errorMessage: null,
                })
                toast.success(t('enterpriseMarketplace.useSuccess', { ns: 'common' }))
                if (leakedDependencies.length) {
                  toast.warning(t('enterpriseMarketplace.dependencyWarning', { ns: 'common', count: leakedDependencies.length }))
                }
                setNeedRefresh('1')
                getRedirection({
                  id: response.import_result.app_id,
                  mode: response.import_result.app_mode as AppModeEnum,
                }, push)
              }
              else {
                const fallbackMessage = t('enterpriseMarketplace.copyStartFailed', { ns: 'common' })
                setCopyFlow({
                  assetId: selectedAsset.id,
                  state: 'failed',
                  errorType: 'start',
                  errorMessage: fallbackMessage,
                })
                toast.error(fallbackMessage)
              }
            },
            onError: (error) => {
              const fallbackMessage = t('enterpriseMarketplace.copyStartFailed', { ns: 'common' })
              const errorMessage = getFriendlyErrorMessage(error, fallbackMessage)
              setCopyFlow({
                assetId: selectedAsset.id,
                state: 'failed',
                errorType: 'start',
                errorMessage,
              })
              toast.error(errorMessage)
            },
          })
        }}
      />
      {showDSLConfirmModal && (
        <DSLConfirmModal
          versions={pendingVersions}
          confirmDisabled={copyFlow.state === 'confirming'}
          onCancel={() => setShowDSLConfirmModal(false)}
          onConfirm={async () => {
            if (!pendingImportIdRef.current)
              return

            try {
              setCopyFlow(current => current.assetId
                ? {
                    ...current,
                    state: 'confirming',
                    errorType: null,
                    errorMessage: null,
                  }
                : current)
              const response = await importDSLConfirm({
                import_id: pendingImportIdRef.current,
              })

              if (response.status === DSLImportStatus.COMPLETED && response.app_id) {
                setCopyFlow(current => current.assetId
                  ? {
                      ...current,
                      state: 'completed',
                      errorType: null,
                      errorMessage: null,
                    }
                  : current)
                toast.success(t('enterpriseMarketplace.useSuccess', { ns: 'common' }))
                setNeedRefresh('1')
                pendingImportIdRef.current = ''
                pendingAssetIdRef.current = ''
                setShowDSLConfirmModal(false)
                getRedirection({
                  id: response.app_id,
                  mode: response.app_mode as AppModeEnum,
                }, push)
                return
              }

              const fallbackMessage = t('enterpriseMarketplace.copyConfirmFailed', { ns: 'common' })
              pendingImportIdRef.current = ''
              pendingAssetIdRef.current = ''
              setShowDSLConfirmModal(false)
              setCopyFlow(current => current.assetId
                ? {
                    ...current,
                    state: 'failed',
                    errorType: 'confirm',
                    errorMessage: fallbackMessage,
                  }
                : current)
              toast.error(fallbackMessage)
            }
            catch (error) {
              const fallbackMessage = t('enterpriseMarketplace.copyConfirmFailed', { ns: 'common' })
              const errorMessage = getFriendlyErrorMessage(error, fallbackMessage)
              pendingImportIdRef.current = ''
              pendingAssetIdRef.current = ''
              setShowDSLConfirmModal(false)
              setCopyFlow(current => current.assetId
                ? {
                    ...current,
                    state: 'failed',
                    errorType: 'confirm',
                    errorMessage,
                  }
                : current)
              toast.error(errorMessage)
            }
          }}
        />
      )}
    </>
  )
}

export default EnterpriseMarketplace
