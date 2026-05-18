'use client'

import type { RemixiconComponentType } from '@remixicon/react'
import {
  RiEqualizer2Fill,
  RiEqualizer2Line,
  RiFileTextFill,
  RiFileTextLine,
  RiFocus2Fill,
  RiFocus2Line,
} from '@remixicon/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { PipelineFill, PipelineLine } from '@/app/components/base/icons/src/vender/pipeline'
import ExtraInfo from '@/app/components/datasets/extra-info'
import { useAppContext } from '@/context/app-context'
import DatasetDetailContext from '@/context/dataset-detail'
import { usePathname } from '@/next/navigation'
import { useDatasetDetail, useDatasetRelatedApps } from '@/service/knowledge/use-dataset'
import DatasetInfo from './dataset-info'
import NavLink from './nav-link'

const getDatasetIdFromPathname = (pathname: string) => {
  const [, section, datasetId] = pathname.split('/')
  return section === 'datasets' ? datasetId : undefined
}

const DatasetDetailSection = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const datasetId = getDatasetIdFromPathname(pathname)
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()
  const { data: datasetRes, refetch: mutateDatasetRes } = useDatasetDetail(datasetId ?? '')
  const { data: relatedApps } = useDatasetRelatedApps(datasetId ?? '', { enabled: !!datasetId && !!datasetRes })

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
    if (!datasetId)
      return []

    const baseNavigation = [
      {
        name: t('datasetMenus.hitTesting', { ns: 'common' }),
        href: `/datasets/${datasetId}/hitTesting`,
        icon: RiFocus2Line,
        selectedIcon: RiFocus2Fill,
        disabled: isButtonDisabledWithPipeline,
      },
      {
        name: t('datasetMenus.settings', { ns: 'common' }),
        href: `/datasets/${datasetId}/settings`,
        icon: RiEqualizer2Line,
        selectedIcon: RiEqualizer2Fill,
        disabled: false,
      },
    ]

    if (datasetRes?.provider !== 'external') {
      baseNavigation.unshift({
        name: t('datasetMenus.pipeline', { ns: 'common' }),
        href: `/datasets/${datasetId}/pipeline`,
        icon: PipelineLine as RemixiconComponentType,
        selectedIcon: PipelineFill as RemixiconComponentType,
        disabled: false,
      })
      baseNavigation.unshift({
        name: t('datasetMenus.documents', { ns: 'common' }),
        href: `/datasets/${datasetId}/documents`,
        icon: RiFileTextLine,
        selectedIcon: RiFileTextFill,
        disabled: isButtonDisabledWithPipeline,
      })
    }

    return baseNavigation
  }, [t, datasetId, isButtonDisabledWithPipeline, datasetRes?.provider])

  if (!datasetRes)
    return null

  return (
    <DatasetDetailContext.Provider value={{
      indexingTechnique: datasetRes.indexing_technique,
      dataset: datasetRes,
      mutateDatasetRes,
    }}
    >
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
        <div className="py-2">
          <DatasetInfo expand />
        </div>
        <div className="px-2 py-2">
          <Divider
            type="horizontal"
            bgStyle="gradient"
            className="my-0 h-px bg-linear-to-r from-divider-subtle to-background-gradient-mask-transparent"
          />
        </div>
        <nav className="flex flex-col gap-y-0.5 px-1 py-2">
          {navigation.map(item => (
            <NavLink
              key={item.href}
              mode="expand"
              iconMap={{ selected: item.selectedIcon, normal: item.icon }}
              name={item.name}
              href={item.href}
              disabled={item.disabled}
              pathname={pathname}
            />
          ))}
        </nav>
        {!isCurrentWorkspaceDatasetOperator && (
          <ExtraInfo
            relatedApps={relatedApps}
            expand
            documentCount={datasetRes.document_count}
          />
        )}
      </div>
    </DatasetDetailContext.Provider>
  )
}

export default DatasetDetailSection
