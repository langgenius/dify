import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { VersionHistoryContextMenuOptions } from '../../../types'
import { workflowAliasTranslation } from '@/i18n/zh-Hans/workflow-alias'
import type { ContextMenuProps } from './index'

const useContextMenu = (props: ContextMenuProps) => {
  const {
    isNamedVersion,
  } = props
  const { t } = useTranslation()
  const aliasT = workflowAliasTranslation

  const deleteOperation = {
    key: VersionHistoryContextMenuOptions.delete,
    name: t('common.operation.delete'),
  }

  const options = useMemo(() => {
    return [
      {
        key: VersionHistoryContextMenuOptions.restore,
        name: t('workflow.common.restore'),
      },
      isNamedVersion
        ? {
          key: VersionHistoryContextMenuOptions.edit,
          name: t('workflow.versionHistory.editVersionInfo'),
        }
        : {
          key: VersionHistoryContextMenuOptions.edit,
          name: t('workflow.versionHistory.nameThisVersion'),
        },
      {
        key: VersionHistoryContextMenuOptions.exportDSL,
        name: t('app.export'),
      },
      {
        key: VersionHistoryContextMenuOptions.copyId,
        name: t('workflow.versionHistory.copyId'),
      },
      {
        key: VersionHistoryContextMenuOptions.manageAlias,
        name: aliasT.manageAlias,
      },
    ]
  }, [isNamedVersion, t])

  return {
    deleteOperation,
    options,
  }
}

export default useContextMenu
