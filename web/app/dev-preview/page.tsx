'use client'

import { useState } from 'react'
import { SwitchPluginVersion } from '../components/workflow/nodes/_base/components/switch-plugin-version'
import { useTranslation } from 'react-i18next'

export default function Page() {
  const [version, setVersion] = useState('0.0.1')
  const { t } = useTranslation()
  return <div className="p-20">
    <SwitchPluginVersion
      uniqueIdentifier={'langgenius/openai:12'}
      onSelect={setVersion}
      version={version}
      tooltip={t('workflow.nodes.agent.switchToNewVersion')}
    />
  </div>
}
