'use client'
import type { FC } from 'react'
import type { DataSourceNotion as TDataSourceNotion } from '@/models/common'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NotionIcon from '@/app/components/base/notion-icon'
import Toast from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import { useDataSourceIntegrates, useNotionConnection } from '@/service/use-common'
import Panel from '../panel'
import { DataSourceType } from '../panel/types'

const Icon: FC<{
  src: string
  name: string
  className: string
}> = ({ src, name, className }) => {
  return (
    <NotionIcon
      src={src}
      name={name}
      className={className}
    />
  )
}
type Props = {
  workspaces?: TDataSourceNotion[]
}

const DataSourceNotion: FC<Props> = ({
  workspaces,
}) => {
  const { isCurrentWorkspaceManager } = useAppContext()
  const [canConnectNotion, setCanConnectNotion] = useState(false)
  const { data: integrates } = useDataSourceIntegrates({
    initialData: workspaces ? { data: workspaces } : undefined,
  })
  const { data } = useNotionConnection(canConnectNotion)
  const { t } = useTranslation()

  const resolvedWorkspaces = integrates?.data ?? []
  const connected = !!resolvedWorkspaces.length

  const handleConnectNotion = () => {
    if (!isCurrentWorkspaceManager)
      return

    setCanConnectNotion(true)
  }

  const handleAuthAgain = () => {
    if (data?.data)
      window.location.href = data.data
    else
      setCanConnectNotion(true)
  }

  useEffect(() => {
    if (data && 'data' in data) {
      if (data.data && typeof data.data === 'string' && data.data.startsWith('http')) {
        window.location.href = data.data
      }
      else if (data.data === 'internal') {
        Toast.notify({
          type: 'info',
          message: t('dataSource.notion.integratedAlert', { ns: 'common' }),
        })
      }
    }
  }, [data, t])

  return (
    <Panel
      type={DataSourceType.notion}
      isConfigured={connected}
      onConfigure={handleConnectNotion}
      readOnly={!isCurrentWorkspaceManager}
      isSupportList
      configuredList={resolvedWorkspaces.map(workspace => ({
        id: workspace.id,
        logo: ({ className }: { className: string }) => (
          <Icon
            src={workspace.source_info.workspace_icon!}
            name={workspace.source_info.workspace_name}
            className={className}
          />
        ),
        name: workspace.source_info.workspace_name,
        isActive: workspace.is_bound,
        notionConfig: {
          total: workspace.source_info.total || 0,
        },
      }))}
      onRemove={noop} // handled in operation/index.tsx
      notionActions={{
        onChangeAuthorizedPage: handleAuthAgain,
      }}
    />
  )
}
export default React.memo(DataSourceNotion)
