'use client'
import type { FC } from 'react'
import type { AgentConfig } from '@/models/debug'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import AgentSetting from './agent/agent-setting'

type Props = Readonly<{
  isFunctionCall: boolean
  isChatModel: boolean
  agentConfig?: AgentConfig
  disabled?: boolean
  onAgentSettingChange: (payload: AgentConfig) => void
}>

const AgentSettingButton: FC<Props> = ({
  onAgentSettingChange,
  isFunctionCall,
  isChatModel,
  agentConfig,
  disabled = false,
}) => {
  const { t } = useTranslation()
  const [isShowAgentSetting, setIsShowAgentSetting] = useState(false)

  return (
    <>
      <Button onClick={() => setIsShowAgentSetting(true)} className="mr-2 shrink-0" disabled={disabled}>
        <span className="mr-1 i-ri-settings-2-line size-4 text-text-tertiary" />
        {t('agent.setting.name', { ns: 'appDebug' })}
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
