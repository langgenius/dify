import type { ActionMenuProps } from './index'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { VersionHistoryContextMenuOptions } from '../../../types'

const useActionMenu = (props: ActionMenuProps) => {
  const { workflowId, isNamedVersion, canImportExportDSL } = props
  const { t } = useTranslation()
  const pipelineId = useStore((s) => s.pipelineId)
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )
  const shouldShowUpgrade = deploymentEdition === 'CLOUD' && plan === 'sandbox'

  const deleteOperation = {
    key: VersionHistoryContextMenuOptions.delete,
    name: t(($) => $['operation.delete'], { ns: 'common' }),
  }

  const options = useMemo(() => {
    return [
      {
        key: VersionHistoryContextMenuOptions.restore,
        name: t(($) => $['common.restore'], { ns: 'workflow' }),
        disabled: deploymentEdition === 'CLOUD' && plan === undefined,
        ...(shouldShowUpgrade ? { showUpgrade: true } : {}),
      },
      isNamedVersion
        ? {
            key: VersionHistoryContextMenuOptions.edit,
            name: t(($) => $['versionHistory.editVersionInfo'], { ns: 'workflow' }),
          }
        : {
            key: VersionHistoryContextMenuOptions.edit,
            name: t(($) => $['versionHistory.nameThisVersion'], { ns: 'workflow' }),
          },
      // todo: pipeline support export specific version DSL
      ...(canImportExportDSL && !pipelineId
        ? [
            {
              key: VersionHistoryContextMenuOptions.exportDSL,
              name: t(($) => $.export, { ns: 'app' }),
              disabled: deploymentEdition === 'CLOUD' && plan === undefined,
              ...(shouldShowUpgrade ? { showUpgrade: true } : {}),
            },
          ]
        : []),
      {
        key: VersionHistoryContextMenuOptions.copyId,
        name: t(($) => $['versionHistory.copyId'], { ns: 'workflow' }),
        description: workflowId,
      },
    ]
  }, [
    deploymentEdition,
    plan,
    canImportExportDSL,
    isNamedVersion,
    pipelineId,
    shouldShowUpgrade,
    t,
    workflowId,
  ])

  return {
    deleteOperation,
    options,
  }
}

export default useActionMenu
