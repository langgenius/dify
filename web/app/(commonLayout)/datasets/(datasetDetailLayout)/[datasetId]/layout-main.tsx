'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import type { RemixiconComponentType } from '@remixicon/react'
import {
  RiEqualizer2Fill,
  RiEqualizer2Line,
  RiFileTextFill,
  RiFileTextLine,
  RiFocus2Fill,
  RiFocus2Line,
} from '@remixicon/react'
import AppSideBar from '@/app/components/app-sidebar'
import Loading from '@/app/components/base/loading'
import DatasetDetailContext from '@/context/dataset-detail'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import { PipelineFill, PipelineLine } from '@/app/components/base/icons/src/vender/pipeline'
import { useDatasetDetail, useDatasetRelatedApps } from '@/service/knowledge/use-dataset'
import useDocumentTitle from '@/hooks/use-document-title'
import ExtraInfo from '@/app/components/datasets/extra-info'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import cn from '@/utils/classnames'

export type IAppDetailLayoutProps = {
  children: React.ReactNode
  params: { datasetId: string }
}

const DatasetDetailLayout: FC<IAppDetailLayoutProps> = (props) => {
  const {
    children,
    params: { datasetId },
  } = props
  const { t } = useTranslation()
  const pathname = usePathname()
  const hideSideBar = pathname.endsWith('documents/create') || pathname.endsWith('documents/create-from-pipeline')
  const isPipelineCanvas = pathname.endsWith('/pipeline')
  const workflowCanvasMaximize = localStorage.getItem('workflow-canvas-maximize') === 'true'
  const [hideHeader, setHideHeader] = useState(workflowCanvasMaximize)
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((v: any) => {
    if (v?.type === 'workflow-canvas-maximize')
      setHideHeader(v.payload)
  })
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const { data: datasetRes, error, refetch: mutateDatasetRes } = useDatasetDetail(datasetId)

  const { data: relatedApps } = useDatasetRelatedApps(datasetId)

  const isButtonDisabledWithPipeline = useMemo(() => {
    if (!datasetRes)
      return true
    if (datasetRes.provider === 'external')
      return false
    if (datasetRes.runtime_mode === 'general')
      return false
    return !datasetRes.is_published
  }, [datasetRes])

  const navigation = useMemo(() => {
    const baseNavigation = [
      {
        name: t('common.datasetMenus.hitTesting'),
        href: `/datasets/${datasetId}/hitTesting`,
        icon: RiFocus2Line,
        selectedIcon: RiFocus2Fill,
        disabled: isButtonDisabledWithPipeline,
      },
      {
        name: t('common.datasetMenus.settings'),
        href: `/datasets/${datasetId}/settings`,
        icon: RiEqualizer2Line,
        selectedIcon: RiEqualizer2Fill,
        disabled: false,
      },
    ]

    if (datasetRes?.provider !== 'external') {
      baseNavigation.unshift({
        name: t('common.datasetMenus.pipeline'),
        href: `/datasets/${datasetId}/pipeline`,
        icon: PipelineLine as RemixiconComponentType,
        selectedIcon: PipelineFill as RemixiconComponentType,
        disabled: false,
      })
      baseNavigation.unshift({
        name: t('common.datasetMenus.documents'),
        href: `/datasets/${datasetId}/documents`,
        icon: RiFileTextLine,
        selectedIcon: RiFileTextFill,
        disabled: isButtonDisabledWithPipeline,
      })
    }

    return baseNavigation
  }, [t, datasetId, isButtonDisabledWithPipeline, datasetRes?.provider])

  useDocumentTitle(datasetRes?.name || t('common.menus.datasets'))

  const setAppSidebarExpand = useStore(state => state.setAppSidebarExpand)

  useEffect(() => {
    const localeMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
    const mode = isMobile ? 'collapse' : 'expand'
    setAppSidebarExpand(isMobile ? mode : localeMode)
  }, [isMobile, setAppSidebarExpand])

  if (!datasetRes && !error)
    return <Loading type='app' />

  return (
    <div
      className={cn(
        'flex grow overflow-hidden',
        hideHeader && isPipelineCanvas ? '' : 'rounded-t-2xl border-t border-effects-highlight',
      )}
    >
      <DatasetDetailContext.Provider value={{
        indexingTechnique: datasetRes?.indexing_technique,
        dataset: datasetRes,
        mutateDatasetRes,
      }}>
        {!hideSideBar && (
          <AppSideBar
            navigation={navigation}
            extraInfo={
              !isCurrentWorkspaceDatasetOperator
                ? mode => <ExtraInfo relatedApps={relatedApps} expand={mode === 'expand'} documentCount={datasetRes?.document_count} />
                : undefined
            }
            iconType='dataset'
          />
        )}
        <div className='grow overflow-hidden bg-background-default-subtle'>{children}</div>
      </DatasetDetailContext.Provider>
    </div>
  )
}
export default React.memo(DatasetDetailLayout)
