'use client'

import { useTranslation } from 'react-i18next'
import { ConfigureSection } from '../configure-section'
import { AgentEnvEditor } from './env-editor'

export function AgentAdvancedSettings() {
  const { t } = useTranslation('agentV2')
  const advancedSettingsPanelId = 'agent-configure-advanced-settings-panel'

  return (
    <ConfigureSection
      label={t('agentDetail.configure.advancedSettings.label')}
      labelId="agent-configure-advanced-settings-label"
      panelId={advancedSettingsPanelId}
      description={t('agentDetail.configure.advancedSettings.description')}
      rootClassName="gap-2 px-1 pt-1 pb-3"
      headerClassName="mb-0 px-3 pt-2"
      titleRowClassName="min-h-6"
      panelContentClassName="flex flex-col rounded-lg bg-background-section"
    >
      <AgentEnvEditor />
    </ConfigureSection>
  )
}
