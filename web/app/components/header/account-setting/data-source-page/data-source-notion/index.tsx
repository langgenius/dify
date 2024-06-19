'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import useSWR from 'swr'
import Panel from '../panel'
import { DataSourceType } from '../panel/types'
import type { DataSourceNotion as TDataSourceNotion } from '@/models/common'
import { useAppContext } from '@/context/app-context'
import { fetchNotionConnection } from '@/service/common'
import NotionIcon from '@/app/components/base/notion-icon'

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
  workspaces: TDataSourceNotion[]
}

const DataSourceNotion: FC<Props> = ({
  workspaces,
}) => {
  const { isCurrentWorkspaceManager } = useAppContext()
  const [canConnectNotion, setCanConnectNotion] = useState(false)
  const { data } = useSWR(canConnectNotion ? '/oauth/data-source/notion' : null, fetchNotionConnection)

  const connected = !!workspaces.length

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
    if (data?.data)
      window.location.href = data.data
  }, [data])
  return (
    <Panel
      type={DataSourceType.notion}
      isConfigured={connected}
      onConfigure={handleConnectNotion}
      readOnly={!isCurrentWorkspaceManager}
      isSupportList
      configuredList={workspaces.map(workspace => ({
        id: workspace.id,
        logo: ({ className }: { className: string }) => (
          <Icon
            src={workspace.source_info.workspace_icon!}
            name={workspace.source_info.workspace_name}
            className={className}
          />),
        name: workspace.source_info.workspace_name,
        isActive: workspace.is_bound,
        notionConfig: {
          total: workspace.source_info.total || 0,
        },
      }))}
      onRemove={() => { }} // handled in operation/index.tsx
      notionActions={{
        onChangeAuthorizedPage: handleAuthAgain,
      }}
    />
  )
}
export default React.memo(DataSourceNotion)
