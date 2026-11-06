import { Button } from '@langgenius/dify-ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useAtomValue } from 'jotai'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowAppSelector as useStore } from '@/app/components/workflow-app/store/workflow'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import { difyBuilderHasSessionAtom } from '../state'

const DifyBuilderPanelToggle = () => {
  const { t } = useTranslation(['difyBuilder'])
  const showDifyBuilderPanel = useStore((s) => s.showDifyBuilderPanel)
  const setShowDifyBuilderPanel = useStore((s) => s.setShowDifyBuilderPanel)
  const canEdit = useHooksStore((s) => s.accessControl.canEdit)
  const { nodesReadOnly } = useNodesReadOnly()
  const hasSession = useAtomValue(difyBuilderHasSessionAtom)
  const disabled = !canEdit || (nodesReadOnly && !hasSession)
  const label = t(($) => $.buttonTooltip, { ns: 'difyBuilder' })

  // React Flow's nokey class preserves native Space activation on the button.
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-expanded={showDifyBuilderPanel}
            aria-label={showDifyBuilderPanel ? label : undefined}
            className="nokey dify-blue-glass-surface relative h-8 shrink-0 rounded-lg p-2 text-text-accent! aria-expanded:w-8 data-disabled:text-components-button-ghost-text-disabled!"
            variant="ghost"
            disabled={disabled}
            onClick={() => setShowDifyBuilderPanel(!showDifyBuilderPanel)}
          >
            <span
              aria-hidden
              className="builder-brand-mark size-4 shrink-0 [button[data-disabled]_&]:opacity-30"
            />
            {!showDifyBuilderPanel && <span className="system-xs-semibold-uppercase">{label}</span>}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export default memo(DifyBuilderPanelToggle)
