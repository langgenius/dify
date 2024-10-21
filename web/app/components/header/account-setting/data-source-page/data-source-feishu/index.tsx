'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useSWRConfig } from 'swr'
import Panel from '../panel'
import { DataSourceType } from '../panel/types'
import FeishuConfigModal from './config-feishu-modal'
import type { DataSourceFeishu as TDataSourceFeishu } from '@/models/common'
import { useAppContext } from '@/context/app-context'
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
  const [showFeishuConfigModal, setShowFeishuConfigModal] = useState(false)
  const [canConnectFeishu, setCanConnectFeishu] = useState(false)
  const connected = !!workspaces.length
  const { mutate } = useSWRConfig()

  const handleConnectFeishu = () => {
    setShowFeishuConfigModal(true)
  }

  const refreshFeishuConfig = () => {
    mutate({ url: 'data-source/integrates' })
  }

  const onSaveFeishuConfig = () => {
    setCanConnectFeishu(true)
    setShowFeishuConfigModal(false)
    refreshFeishuConfig()
  }

  const cancelFeishuConfig = () => {
    setShowFeishuConfigModal(false)
  }

  const handleAuthAgain = () => {
    // 目前暂时没有动作
  }

  return (
    <>
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
        onRemove={() => { }}
        notionActions={{
          onChangeAuthorizedPage: handleAuthAgain,
        }}
      />
      {showFeishuConfigModal && (
        <FeishuConfigModal onSaved={onSaveFeishuConfig} onCancel={cancelFeishuConfig} />
      )}
    </>
  )
}
export default React.memo(DataSourceFeishu)
