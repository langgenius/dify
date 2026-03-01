import type { ContextMenuProps } from './index'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { VersionHistoryContextMenuOptions } from '../../../types'

const useContextMenu = (props: ContextMenuProps) => {
  const {
    isNamedVersion,
  } = props
  const { t } = useTranslation()
  const pipelineId = useStore(s => s.pipelineId)

  const deleteOperation = {
    key: VersionHistoryContextMenuOptions.delete,
    name: t('operation.delete', { ns: 'common' }),
  }

  const options = useMemo(() => {
    return [
      {
        key: VersionHistoryContextMenuOptions.restore,
        name: t('common.restore', { ns: 'workflow' }),
      },
      isNamedVersion
        ? {
            key: VersionHistoryContextMenuOptions.edit,
            name: t('versionHistory.editVersionInfo', { ns: 'workflow' }),
          }
        : {
            key: VersionHistoryContextMenuOptions.edit,
            name: t('versionHistory.nameThisVersion', { ns: 'workflow' }),
          },
      // todo: pipeline support export specific version DSL
      ...(!pipelineId
        ? [{
            key: VersionHistoryContextMenuOptions.exportDSL,
            name: t('export', { ns: 'app' }),
          }]
        : []),
      {
        key: VersionHistoryContextMenuOptions.copyId,
        name: t('versionHistory.copyId', { ns: 'workflow' }),
      },
    ]
  }, [isNamedVersion, t])

  return {
    deleteOperation,
    options,
  }
}

export default useContextMenu
