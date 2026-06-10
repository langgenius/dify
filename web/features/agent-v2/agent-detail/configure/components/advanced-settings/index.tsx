'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentEnvEditor } from './env-editor'

export function AgentAdvancedSettings() {
  const { t } = useTranslation('agentV2')
  const [isExpanded, setIsExpanded] = useState(true)
  const advancedSettingsPanelId = 'agent-configure-advanced-settings-panel'

  return (
    <section className="flex flex-col gap-2 px-1 pt-1 pb-3" aria-labelledby="agent-configure-advanced-settings-label">
      <div className="flex flex-col px-3 pt-2">
        <div className="flex min-h-6 items-center">
          <h3
            id="agent-configure-advanced-settings-label"
            className="truncate system-sm-semibold-uppercase text-text-secondary"
          >
            {t('agentDetail.configure.advancedSettings.label')}
          </h3>
          <button
            type="button"
            aria-label={t('agentDetail.configure.advancedSettings.toggle')}
            aria-controls={advancedSettingsPanelId}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded(expanded => !expanded)}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-quaternary hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span
              aria-hidden
              className={`i-custom-vender-solid-arrows-arrow-down-round-fill size-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
            />
          </button>
        </div>
        <p className="system-xs-regular text-text-tertiary">
          {t('agentDetail.configure.advancedSettings.description')}
        </p>
      </div>

      {isExpanded && (
        <div
          id={advancedSettingsPanelId}
          className="flex flex-col rounded-lg bg-background-section"
        >
          <AgentEnvEditor />
        </div>
      )}
    </section>
  )
}
