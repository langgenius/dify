import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { VersionHistoryContextMenuOptions } from '../../../types'
import type { ContextMenuProps } from './index'
import { useStore } from '@/app/components/workflow/store'

const useContextMenu = (props: ContextMenuProps) => {
  const {
    isNamedVersion,
  } = props
  const { t } = useTranslation()
  const pipelineId = useStore(s => s.pipelineId)

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
      // todo: pipeline support export specific version DSL
      ...(!pipelineId ? [{
        key: VersionHistoryContextMenuOptions.exportDSL,
        name: t('app.export'),
      }] : []),
      {
        key: VersionHistoryContextMenuOptions.copyId,
        name: t('workflow.versionHistory.copyId'),
      },
    ]
  }, [isNamedVersion, t])

  return {
    deleteOperation,
    options,
  }
}

export default useContextMenu
