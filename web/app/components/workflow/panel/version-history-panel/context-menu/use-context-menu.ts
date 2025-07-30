import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { VersionHistoryContextMenuOptions } from '../../../types'
import type { ContextMenuProps } from './index'

const useContextMenu = (props: ContextMenuProps) => {
  const {
    isNamedVersion,
  } = props
  const { t } = useTranslation()

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
      {
        key: VersionHistoryContextMenuOptions.copyId,
        name: t('workflow.versionHistory.copyId'),
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
    ]
  }, [isNamedVersion])

  return {
    deleteOperation,
    options,
  }
}

export default useContextMenu
