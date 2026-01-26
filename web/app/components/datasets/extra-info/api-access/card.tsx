import { RiArrowRightUpLine, RiBookOpenLine } from '@remixicon/react'
import Link from 'next/link'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Indicator from '@/app/components/header/indicator'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDatasetApiAccessUrl } from '@/hooks/use-api-access-url'
import { useDisableDatasetServiceApi, useEnableDatasetServiceApi } from '@/service/knowledge/use-dataset'
import { cn } from '@/utils/classnames'

type CardProps = {
  apiEnabled: boolean
}

const Card = ({
  apiEnabled,
}: CardProps) => {
  const { t } = useTranslation()
  const datasetId = useDatasetDetailContextWithSelector(state => state.dataset?.id)
  const mutateDatasetRes = useDatasetDetailContextWithSelector(state => state.mutateDatasetRes)
  const { mutateAsync: enableDatasetServiceApi } = useEnableDatasetServiceApi()
  const { mutateAsync: disableDatasetServiceApi } = useDisableDatasetServiceApi()

  const isCurrentWorkspaceManager = useAppContextSelector(state => state.isCurrentWorkspaceManager)

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
              <Indicator
                className="shrink-0"
                color={apiEnabled ? 'green' : 'yellow'}
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
              defaultValue={apiEnabled}
              onChange={onToggle}
              disabled={!isCurrentWorkspaceManager}
            />
          </div>
          <div className="system-xs-regular text-text-tertiary">
            {t('appMenus.apiAccessTip', { ns: 'common' })}
          </div>
        </div>
      </div>
      <div className="h-px bg-divider-subtle"></div>
      <div className="p-1">
        <Link
          href={apiReferenceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 items-center space-x-[7px] rounded-lg px-2 text-text-tertiary hover:bg-state-base-hover"
        >
          <RiBookOpenLine className="size-3.5 shrink-0" />
          <div className="system-sm-regular grow truncate">
            {t('overview.apiInfo.doc', { ns: 'appOverview' })}
          </div>
          <RiArrowRightUpLine className="size-3.5 shrink-0" />
        </Link>
      </div>
    </div>
  )
}

export default React.memo(Card)
