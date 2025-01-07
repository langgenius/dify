'use client'

import { SwitchPluginVersion } from '../components/workflow/nodes/_base/components/switch-plugin-version'
import { useTranslation } from 'react-i18next'

export default function Page() {
  const { t } = useTranslation()
  return <div className="p-20">
    <SwitchPluginVersion
      uniqueIdentifier={'langgenius/openai:12'}
      tooltip={t('workflow.nodes.agent.switchToNewVersion')}
    />
  </div>
}
