'use client'

import { useTranslation } from 'react-i18next'
import { ConfigureSection } from '../common/section'
import { AgentContentModerationSettings } from './content-moderation'
import { AgentEnvEditor } from './env'

export function AgentAdvancedSettings() {
  const { t } = useTranslation('agentV2')
  const advancedSettingsPanelId = 'agent-configure-advanced-settings-panel'

  return (
    <ConfigureSection
      label={t('agentDetail.configure.advancedSettings.label')}
      labelId="agent-configure-advanced-settings-label"
      panelId={advancedSettingsPanelId}
      description={t('agentDetail.configure.advancedSettings.description')}
      rootClassName="gap-2 pt-1 pb-3"
      headerClassName="mb-0 pt-2"
      titleRowClassName="min-h-6"
      panelContentClassName="flex flex-col rounded-lg bg-background-section"
    >
      <AgentEnvEditor />
      <AgentContentModerationSettings />
    </ConfigureSection>
  )
}
