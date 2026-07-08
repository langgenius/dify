import { cn } from '@langgenius/dify-ui/cn'
import { PopoverClose } from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDatasetApiAccessUrl } from '@/hooks/use-api-access-url'
import Link from '@/next/link'
import { useDisableDatasetServiceApi, useEnableDatasetServiceApi } from '@/service/knowledge/use-dataset'
import { getDatasetACLCapabilities } from '@/utils/permission'

type CardProps = {
  apiEnabled: boolean
  onOpenSecretKeyModal: () => void
}

const Card = ({
  apiEnabled,
  onOpenSecretKeyModal,
}: CardProps) => {
  const { t } = useTranslation()
  const datasetId = useDatasetDetailContextWithSelector(state => state.dataset?.id)
  const dataset = useDatasetDetailContextWithSelector(state => state.dataset)
  const mutateDatasetRes = useDatasetDetailContextWithSelector(state => state.mutateDatasetRes)
  const currentUserId = useAppContextWithSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const { mutateAsync: enableDatasetServiceApi } = useEnableDatasetServiceApi()
  const { mutateAsync: disableDatasetServiceApi } = useDisableDatasetServiceApi()

  const datasetACLCapabilities = React.useMemo(
    () => getDatasetACLCapabilities(dataset?.permission_keys, {
      currentUserId,
      resourceMaintainer: dataset?.maintainer,
      workspacePermissionKeys,
    }),
    [dataset?.maintainer, dataset?.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const canManageApiAccess = datasetACLCapabilities.canEdit

  const apiReferenceUrl = useDatasetApiAccessUrl()

  const onToggle = useCallback(async (state: boolean) => {
    let result: 'success' | 'fail'
    if (state)
      result = (await enableDatasetServiceApi(datasetId ?? '')).result
    else
      result = (await disableDatasetServiceApi(datasetId ?? '')).result
    if (result === 'success')
      mutateDatasetRes?.()
  }, [datasetId, enableDatasetServiceApi, mutateDatasetRes, disableDatasetServiceApi])

  return (
    <div className="w-[208px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg">
      <div className="p-1">
        <div className="p-2">
          <div className="mb-1.5 flex justify-between">
            <div className="flex items-center gap-1">
              <StatusDot
                className="shrink-0"
                status={apiEnabled ? 'success' : 'warning'}
              />
              <div
                className={cn(
                  'system-xs-semibold-uppercase',
                  apiEnabled ? 'text-text-success' : 'text-text-warning',
                )}
              >
                {apiEnabled
                  ? t('serviceApi.enabled', { ns: 'dataset' })
                  : t('serviceApi.disabled', { ns: 'dataset' })}
              </div>
            </div>
            <Switch
              checked={apiEnabled}
              onCheckedChange={onToggle}
              disabled={!canManageApiAccess}
            />
          </div>
          <div className="system-xs-regular text-text-tertiary">
            {t('appMenus.apiAccessTip', { ns: 'common' })}
          </div>
        </div>
      </div>
      <div className="h-px bg-divider-subtle"></div>
      <div className="p-1">
        <PopoverClose
          render={(
            <button
              type="button"
              className="flex h-8 w-full items-center space-x-[7px] rounded-lg border-none bg-transparent px-2 text-left text-text-tertiary hover:bg-state-base-hover"
              onClick={onOpenSecretKeyModal}
            >
              <span className="i-ri-key-2-line size-3.5 shrink-0" />
              <div className="grow truncate system-sm-regular">
                {t('serviceApi.card.apiKey', { ns: 'dataset' })}
              </div>
            </button>
          )}
        />
        <Link
          href={apiReferenceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 items-center space-x-[7px] rounded-lg px-2 text-text-tertiary hover:bg-state-base-hover"
        >
          <span className="i-ri-book-open-line size-3.5 shrink-0" />
          <div className="grow truncate system-sm-regular">
            {t('overview.apiInfo.doc', { ns: 'appOverview' })}
          </div>
          <span className="i-ri-arrow-right-up-line size-3.5 shrink-0" />
        </Link>
      </div>
    </div>
  )
}

export default React.memo(Card)
