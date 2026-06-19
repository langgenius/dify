'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import DatasetDetailContext from '@/context/dataset-detail'
import useDocumentTitle from '@/hooks/use-document-title'
import { usePathname, useRouter } from '@/next/navigation'
import { useDatasetDetail } from '@/service/knowledge/use-dataset'
import { getDatasetACLCapabilities } from '@/utils/permission'

type IAppDetailLayoutProps = {
  children: React.ReactNode
  datasetId: string
}

const getResponseStatus = (error: unknown) => {
  if (error instanceof Response)
    return error.status

  if (typeof error === 'object' && error && 'status' in error && typeof error.status === 'number')
    return error.status
}

const shouldRedirectToDatasetList = (error: unknown) => {
  const status = getResponseStatus(error)
  return status === 403 || status === 404
}

const getDatasetRedirectionPath = (
  dataset: DataSet,
  datasetACLCapabilities: ReturnType<typeof getDatasetACLCapabilities>,
) => {
  if (dataset.provider === 'external') {
    if (datasetACLCapabilities.canRetrievalRecall)
      return `/datasets/${dataset.id}/hitTesting`

    return `/datasets/${dataset.id}/settings`
  }

  if (dataset.runtime_mode === 'rag_pipeline' && !dataset.is_published)
    return `/datasets/${dataset.id}/pipeline`

  return `/datasets/${dataset.id}/documents`
}

const DatasetDetailLayout: FC<IAppDetailLayoutProps> = (props) => {
  const {
    children,
    datasetId,
  } = props
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const {
    isLoadingCurrentWorkspace,
    isLoadingWorkspacePermissionKeys,
    userProfile,
    workspacePermissionKeys,
  } = useAppContext()

  const { data: datasetRes, error, refetch: mutateDatasetRes } = useDatasetDetail(datasetId)
  const shouldRedirect = shouldRedirectToDatasetList(error)
  const datasetACLCapabilities = React.useMemo(() => getDatasetACLCapabilities(datasetRes?.permission_keys, {
    currentUserId: userProfile?.id,
    resourceMaintainer: datasetRes?.maintainer,
    workspacePermissionKeys,
  }), [datasetRes?.maintainer, datasetRes?.permission_keys, userProfile?.id, workspacePermissionKeys])
  const isAccessConfigPath = pathname.endsWith('/access-config')
  const isHitTestingPath = pathname.endsWith('/hitTesting')
  const isPermissionControlledPath = isAccessConfigPath || isHitTestingPath
  const isCheckingRouteAccess = !!datasetRes
    && isPermissionControlledPath
    && (isLoadingCurrentWorkspace || !!isLoadingWorkspacePermissionKeys)
  const shouldRedirectUnauthorizedRoute = !!datasetRes
    && !isCheckingRouteAccess
    && (
      (isAccessConfigPath && !datasetACLCapabilities.canAccessConfig)
      || (isHitTestingPath && !datasetACLCapabilities.canRetrievalRecall)
    )

  useDocumentTitle(datasetRes?.name || t('menus.datasets', { ns: 'common' }))

  useEffect(() => {
    if (shouldRedirect)
      router.replace('/datasets')
  }, [router, shouldRedirect])

  useEffect(() => {
    if (!datasetRes || !shouldRedirectUnauthorizedRoute)
      return

    router.replace(getDatasetRedirectionPath(datasetRes, datasetACLCapabilities))
  }, [datasetACLCapabilities, datasetRes, router, shouldRedirectUnauthorizedRoute])

  if (!datasetRes && !error)
    return <Loading type="app" />

  if (shouldRedirect)
    return <Loading type="app" />

  if (isCheckingRouteAccess || shouldRedirectUnauthorizedRoute)
    return <Loading type="app" />

  const isPipelinePage = pathname.endsWith('/pipeline') || pathname.includes('/create-from-pipeline')

  return (
    <div
      className={cn(
        'relative flex h-0 grow overflow-hidden',
        !isPipelinePage && 'pt-1 pr-1 pb-1',
      )}
    >
      <DatasetDetailContext.Provider value={{
        indexingTechnique: datasetRes?.indexing_technique,
        dataset: datasetRes,
        mutateDatasetRes,
      }}
      >
        <div className={cn(
          'grow overflow-hidden bg-components-panel-bg',
          !isPipelinePage && 'rounded-lg shadow-xs shadow-shadow-shadow-3',
        )}
        >
          {children}
        </div>
      </DatasetDetailContext.Provider>
    </div>
  )
}
export default React.memo(DatasetDetailLayout)
