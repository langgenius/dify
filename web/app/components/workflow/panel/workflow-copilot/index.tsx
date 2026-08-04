import { RiSparkling2Line } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import CopilotChat from './copilot-chat'

/**
 * Right-side "Workflow Copilot" panel shell.
 *
 * Mirrors the layout of `debug-and-preview/index.tsx` (fixed header + scrollable
 * body) but hosts the graph-building chat instead of a run session. Visibility
 * is driven by the `showCopilotPanel` flag in the workflow panel slice; closing
 * simply flips that flag off.
 */
const WorkflowCopilotPanel = () => {
  const { t } = useTranslation()
  const setShowCopilotPanel = useStore(s => s.setShowCopilotPanel)

  return (
    <div className="relative h-full">
      <div className="relative flex h-full w-[420px] flex-col rounded-l-2xl border border-r-0 border-components-panel-border bg-components-panel-bg shadow-xl">
        <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2 system-xl-semibold text-text-primary">
          <div className="flex h-8 items-center gap-1.5">
            <RiSparkling2Line className="size-5 text-text-accent" />
            {t('workflow.workflowGenerator.copilotTitle', { defaultValue: 'WORKFLOW COPILOT' })}
          </div>
          <button
            type="button"
            aria-label={t('common.operation.cancel', { defaultValue: 'Close' })}
            className="flex size-6 cursor-pointer items-center justify-center"
            onClick={() => setShowCopilotPanel(false)}
          >
            <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
          </button>
        </div>
        <div className="grow overflow-hidden rounded-b-2xl">
          <CopilotChat />
        </div>
      </div>
    </div>
  )
}

export default memo(WorkflowCopilotPanel)
