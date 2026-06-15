'use client'

import type { RemixiconComponentType } from '@remixicon/react'
import { cn } from '@langgenius/dify-ui/cn'
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

type DatasetDetailSectionProps = {
  expand?: boolean
}

const DatasetDetailSection = ({
  expand = true,
}: DatasetDetailSectionProps) => {
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
      <div className={cn('flex min-h-0 flex-1 flex-col', expand ? 'px-2 pb-2' : 'pb-2')}>
        {!expand && (
          <div className="flex w-full shrink-0 justify-center px-3.5 pt-0.5 pb-[3px]">
            <Divider
              type="horizontal"
              bgStyle="solid"
              className="my-0 h-px w-[27px] bg-divider-subtle"
            />
          </div>
        )}
        <div className="py-2">
          <DatasetInfo expand={expand} />
        </div>
        <nav className={cn('mt-3 flex flex-col gap-y-0.5 pb-2', expand ? 'px-1' : 'px-3')}>
          {navigation.map(item => (
            <NavLink
              key={item.href}
              mode={expand ? 'expand' : 'collapse'}
              iconMap={{ selected: item.selectedIcon, normal: item.icon }}
              name={item.name}
              href={item.href}
              disabled={item.disabled}
              pathname={pathname}
            />
          ))}
        </nav>
        {!isCurrentWorkspaceDatasetOperator && (
          <div className="mt-auto shrink-0">
            <ExtraInfo
              relatedApps={relatedApps}
              expand={expand}
              documentCount={datasetRes.document_count}
            />
          </div>
        )}
      </div>
    </DatasetDetailContext.Provider>
  )
}

export default DatasetDetailSection
