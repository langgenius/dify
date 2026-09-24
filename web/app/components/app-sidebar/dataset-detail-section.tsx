'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ExtraInfo from '@/app/components/datasets/extra-info'
import DatasetDetailContext from '@/context/dataset-detail'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { usePathname } from '@/next/navigation'
import { useDatasetDetail, useDatasetRelatedApps } from '@/service/knowledge/use-dataset'
import { getDatasetACLCapabilities } from '@/utils/permission'
import DatasetInfo from './dataset-info'
import NavLink from './nav-link'

const getDatasetIdFromPathname = (pathname: string) => {
  const [, section, datasetId] = pathname.split('/')
  return section === 'datasets' ? datasetId : undefined
}

type DatasetDetailSectionProps = {
  expand?: boolean
}

const DatasetDetailSection = ({ expand = true }: DatasetDetailSectionProps) => {
  const { t } = useTranslation(['common', 'navigation'])
  const pathname = usePathname()
  const datasetId = getDatasetIdFromPathname(pathname)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const { data: datasetRes, refetch: mutateDatasetRes } = useDatasetDetail(datasetId ?? '')
  const { data: relatedApps } = useDatasetRelatedApps(datasetId ?? '', {
    enabled: !!datasetId && !!datasetRes,
  })
  const datasetACLCapabilities = useMemo(
    () =>
      getDatasetACLCapabilities(datasetRes?.permission_keys, {
        currentUserId,
        resourceMaintainer: datasetRes?.maintainer,
        workspacePermissionKeys,
        isRbacEnabled,
      }),
    [
      currentUserId,
      datasetRes?.maintainer,
      datasetRes?.permission_keys,
      isRbacEnabled,
      workspacePermissionKeys,
    ],
  )

  const isButtonDisabledWithPipeline = useMemo(() => {
    if (!datasetRes) return true
    if (datasetRes.provider === 'external') return false
    if (datasetRes.runtime_mode === 'general') return false
    return !datasetRes.is_published
  }, [datasetRes])

  const navigation = useMemo(() => {
    if (!datasetId) return []

    const baseNavigation: {
      name: string
      href: string
      icon: string
      selectedIcon: string
      disabled: boolean
    }[] = [
      {
        name: t(($) => $['datasetMenus.hitTesting'], { ns: 'common' }),
        href: `/datasets/${datasetId}/hitTesting`,
        icon: 'i-ri-focus-2-line',
        selectedIcon: 'i-ri-focus-2-fill',
        disabled: isButtonDisabledWithPipeline || !datasetACLCapabilities.canRetrievalRecall,
      },
      {
        name: t(($) => $['datasetMenus.settings'], { ns: 'common' }),
        href: `/datasets/${datasetId}/settings`,
        icon: 'i-ri-equalizer-2-line',
        selectedIcon: 'i-ri-equalizer-2-fill',
        disabled: false,
      },
      ...(datasetACLCapabilities.canAccessConfig
        ? [
            {
              name: t(($) => $['settings.resourceAccess'], { ns: 'navigation' }),
              href: `/datasets/${datasetId}/access-config`,
              icon: 'i-ri-lock-2-line',
              selectedIcon: 'i-ri-lock-2-fill',
              disabled: false,
            },
          ]
        : []),
    ]

    if (datasetRes?.provider !== 'external') {
      baseNavigation.unshift({
        name: t(($) => $['datasetMenus.pipeline'], { ns: 'common' }),
        href: `/datasets/${datasetId}/pipeline`,
        icon: 'i-custom-vender-pipeline-pipeline-line',
        selectedIcon: 'i-custom-vender-pipeline-pipeline-fill',
        disabled: false,
      })
      baseNavigation.unshift({
        name: t(($) => $['datasetMenus.documents'], { ns: 'common' }),
        href: `/datasets/${datasetId}/documents`,
        icon: 'i-ri-file-text-line',
        selectedIcon: 'i-ri-file-text-fill',
        disabled: isButtonDisabledWithPipeline,
      })
    }

    return baseNavigation
  }, [t, datasetId, isButtonDisabledWithPipeline, datasetRes?.provider, datasetACLCapabilities])

  if (!datasetRes) return null

  return (
    <DatasetDetailContext.Provider
      value={{
        indexingTechnique: datasetRes.indexing_technique,
        dataset: datasetRes,
        mutateDatasetRes,
      }}
    >
      <div className={cn('flex min-h-0 flex-1 flex-col', expand ? 'px-2 pb-2' : 'pb-2')}>
        {!expand && (
          <div className="flex w-full shrink-0 justify-center px-3.5 pt-0.5 pb-0.75">
            <Separator
              decorative
              orientation="horizontal"
              variant="solid"
              className="my-0 w-6.75 bg-divider-subtle"
            />
          </div>
        )}
        <div className="py-2">
          <DatasetInfo expand={expand} />
        </div>
        <nav className={cn('mt-3 flex flex-col gap-y-0.5 pb-2', expand ? 'px-1' : 'px-3')}>
          {navigation.map((item) => (
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
        {datasetACLCapabilities.canEdit && (
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
