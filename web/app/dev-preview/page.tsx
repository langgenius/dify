'use client'

import { ToolTipContent } from '../components/base/tooltip/content'
import { SwitchPluginVersion } from '../components/workflow/nodes/_base/components/switch-plugin-version'
import { useTranslation } from 'react-i18next'

export default function Page() {
  const { t } = useTranslation()
  return <div className="p-20">
    <SwitchPluginVersion
      uniqueIdentifier={'langgenius/openai:12'}
      tooltip={<ToolTipContent
        title={t('workflow.nodes.agent.unsupportedStrategy')}
      >
        {t('workflow.nodes.agent.strategyNotFoundDescAndSwitchVersion')}
      </ToolTipContent>}
    />
  </div>
}
