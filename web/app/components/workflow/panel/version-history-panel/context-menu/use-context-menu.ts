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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNamedVersion])

  return {
    deleteOperation,
    options,
  }
}

export default useContextMenu
