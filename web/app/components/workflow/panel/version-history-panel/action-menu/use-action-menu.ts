import type { ActionMenuProps } from './index'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plan } from '@/app/components/billing/type'
import { useStore } from '@/app/components/workflow/store'
import { useProviderContext } from '@/context/provider-context'
import { VersionHistoryContextMenuOptions } from '../../../types'

const useActionMenu = (props: ActionMenuProps) => {
  const {
    isNamedVersion,
    canImportExportDSL,
  } = props
  const { t } = useTranslation()
  const pipelineId = useStore(s => s.pipelineId)
  const { plan, enableBilling } = useProviderContext()
  const shouldShowUpgrade = enableBilling && plan.type === Plan.sandbox

  const deleteOperation = {
    key: VersionHistoryContextMenuOptions.delete,
    name: t($ => $['operation.delete'], { ns: 'common' }),
  }

  const options = useMemo(() => {
    return [
      {
        key: VersionHistoryContextMenuOptions.restore,
        name: t($ => $['common.restore'], { ns: 'workflow' }),
        ...(shouldShowUpgrade ? { showUpgrade: true } : {}),
      },
      isNamedVersion
        ? {
            key: VersionHistoryContextMenuOptions.edit,
            name: t($ => $['versionHistory.editVersionInfo'], { ns: 'workflow' }),
          }
        : {
            key: VersionHistoryContextMenuOptions.edit,
            name: t($ => $['versionHistory.nameThisVersion'], { ns: 'workflow' }),
          },
      // todo: pipeline support export specific version DSL
      ...(canImportExportDSL && !pipelineId
        ? [{
            key: VersionHistoryContextMenuOptions.exportDSL,
            name: t($ => $['export'], { ns: 'app' }),
            ...(shouldShowUpgrade ? { showUpgrade: true } : {}),
          }]
        : []),
      {
        key: VersionHistoryContextMenuOptions.copyId,
        name: t($ => $['versionHistory.copyId'], { ns: 'workflow' }),
      },
    ]
  }, [canImportExportDSL, isNamedVersion, pipelineId, shouldShowUpgrade, shouldShowUpgrade, t])

  return {
    deleteOperation,
    options,
  }
}

export default useActionMenu
