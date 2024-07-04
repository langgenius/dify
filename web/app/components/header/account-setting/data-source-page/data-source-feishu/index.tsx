'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import useSWR from 'swr'
import Panel from '../panel'
import { DataSourceType } from '../panel/types'
import { FeishuProvider } from './constants'
import type { DataSourceFeishu as TDataSourceFeishu } from '@/models/common'
import { useAppContext } from '@/context/app-context'
import { fetchFeishuConnection } from '@/service/common'
import FeishuIcon from '@/app/components/base/feishu-icon'

const Icon: FC<{
  src: string
  name: string
  className: string
}> = ({ src, name, className }) => {
  return (
    <FeishuIcon
      src={src}
      name={name}
      className={className}
    />
  )
}
type Props = {
  workspaces: TDataSourceFeishu[]
}

const DataSourceFeishu: FC<Props> = ({
  workspaces,
}) => {
  const { isCurrentWorkspaceManager } = useAppContext()
  const [canConnectFeishu, setCanConnectFeishu] = useState(false)
  const { data } = useSWR(canConnectFeishu ? `/oauth/data-source/${FeishuProvider}` : null, fetchFeishuConnection)

  const connected = !!workspaces.length

  const handleConnectFeishu = () => {
    if (!isCurrentWorkspaceManager)
      return

    setCanConnectFeishu(true)
  }

  const handleAuthAgain = () => {
    if (data?.data)
      // TODO 跳转飞书，这里返回是空
      window.location.href = data.data
    else
      setCanConnectFeishu(true)
  }

  useEffect(() => {
    if (data?.data)
      window.location.href = data.data
  }, [data])
  return (
    <Panel
      type={DataSourceType.feishu}
      isConfigured={connected}
      onConfigure={handleConnectFeishu}
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
        feishuConfig: {
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
export default React.memo(DataSourceFeishu)
