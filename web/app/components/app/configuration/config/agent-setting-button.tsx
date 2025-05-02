'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiSettings2Line } from '@remixicon/react'
import AgentSetting from './agent/agent-setting'
import Button from '@/app/components/base/button'
import type { AgentConfig } from '@/models/debug'

type Props = {
  isFunctionCall: boolean
  isChatModel: boolean
  agentConfig?: AgentConfig
  onAgentSettingChange: (payload: AgentConfig) => void
}

const AgentSettingButton: FC<Props> = ({
  onAgentSettingChange,
  isFunctionCall,
  isChatModel,
  agentConfig,
}) => {
  const { t } = useTranslation()
  const [isShowAgentSetting, setIsShowAgentSetting] = useState(false)

  return (
    <>
      <Button onClick={() => setIsShowAgentSetting(true)} className='shrink-0 mr-2'>
        <RiSettings2Line className='mr-1 w-4 h-4 text-text-tertiary' />
        {t('appDebug.agent.setting.name')}
      </Button>
      {isShowAgentSetting && (
        <AgentSetting
          isFunctionCall={isFunctionCall}
          payload={agentConfig as AgentConfig}
          isChatModel={isChatModel}
          onSave={(payloadNew) => {
            onAgentSettingChange(payloadNew)
            setIsShowAgentSetting(false)
          }}
          onCancel={() => setIsShowAgentSetting(false)}
        />
      )}
    </>
  )
}
export default React.memo(AgentSettingButton)
