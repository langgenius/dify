import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export const START_PLACEHOLDER_PANEL_TITLE_ID = 'workflow-start-placeholder-panel-title'

export function StartPlaceholderPanelTitle() {
  const { t } = useTranslation()

  return (
    <h2
      id={START_PLACEHOLDER_PANEL_TITLE_ID}
      className="mr-2 min-w-0 grow system-xl-semibold text-text-primary"
    >
      {t(($) => $['nodes.startPlaceholder.panelTitle'], { ns: 'workflow' })}
    </h2>
  )
}

export function StartPlaceholderPanelDescription() {
  const { t } = useTranslation()

  return (
    <div className="px-4 pb-3 system-xs-regular text-text-tertiary">
      {t(($) => $['nodes.startPlaceholder.panelDescription'], { ns: 'workflow' })}
    </div>
  )
}

export function StartPlaceholderPanelBody({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
}
