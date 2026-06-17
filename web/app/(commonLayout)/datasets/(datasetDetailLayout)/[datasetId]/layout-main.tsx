'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import DatasetDetailContext from '@/context/dataset-detail'
import useDocumentTitle from '@/hooks/use-document-title'
import { usePathname, useRouter } from '@/next/navigation'
import { useDatasetDetail } from '@/service/knowledge/use-dataset'

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

const DatasetDetailLayout: FC<IAppDetailLayoutProps> = (props) => {
  const {
    children,
    datasetId,
  } = props
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()

  const { data: datasetRes, error, refetch: mutateDatasetRes } = useDatasetDetail(datasetId)
  const shouldRedirect = shouldRedirectToDatasetList(error)

  useDocumentTitle(datasetRes?.name || t('menus.datasets', { ns: 'common' }))

  useEffect(() => {
    if (shouldRedirect)
      router.replace('/datasets')
  }, [router, shouldRedirect])

  if (!datasetRes && !error)
    return <Loading type="app" />

  if (shouldRedirect)
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
