import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@langgenius/dify-ui/collapsible'
import { useTranslation } from 'react-i18next'

export function AgentAdvancedSettings() {
  const { t } = useTranslation()

  return (
    <Collapsible className="border-b border-divider-subtle py-2">
      <CollapsibleTrigger className="group h-8 min-h-0 justify-start gap-0 rounded-none px-4 py-0 hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-text-secondary data-panel-open:text-text-secondary">
        <span className="min-w-0 truncate system-sm-semibold-uppercase text-text-secondary">
          {t($ => $['nodes.agent.advancedSetting'], { ns: 'workflow' })}
        </span>
        <span
          aria-hidden="true"
          className="i-custom-vender-solid-general-arrow-down-round-fill size-4 rotate-270 text-text-quaternary transition-transform group-data-panel-open:rotate-0 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="px-4" />
      </CollapsiblePanel>
    </Collapsible>
  )
}
