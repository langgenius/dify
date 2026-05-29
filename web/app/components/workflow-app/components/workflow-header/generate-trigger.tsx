import type { WorkflowGeneratorMode } from '@/app/components/workflow/workflow-generator/types'
import { Button } from '@langgenius/dify-ui/button'
import { RiSparkling2Line } from '@remixicon/react'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { useWorkflowGeneratorStore } from '@/app/components/workflow/workflow-generator/store'
import { AppModeEnum } from '@/types/app'

/**
 * Studio toolbar button that opens the AI workflow generator with the app's
 * mode locked to whatever the current app actually is. Only renders for
 * Workflow / Advanced-Chat apps (the only modes that have a graph-based
 * Studio), so we can never produce the mode-mismatch dead-end that the old
 * cmd+k `/create` URL-sniffing path used to.
 *
 * The button is disabled whenever the canvas is in read-only mode (run in
 * progress / published version being viewed), mirroring the disable rule the
 * other Studio mutators (Env / Global Var) follow.
 */
const GenerateTrigger = () => {
  const { t } = useTranslation('workflow')
  const appDetail = useAppStore(s => s.appDetail)
  const { nodesReadOnly } = useNodesReadOnly()

  const mode: WorkflowGeneratorMode | null = useMemo(() => {
    if (appDetail?.mode === AppModeEnum.WORKFLOW)
      return 'workflow'
    if (appDetail?.mode === AppModeEnum.ADVANCED_CHAT)
      return 'advanced-chat'
    return null
  }, [appDetail?.mode])

  if (!appDetail || !mode)
    return null

  return (
    <Button
      variant="secondary"
      disabled={nodesReadOnly}
      onClick={() =>
        useWorkflowGeneratorStore.getState().openGenerator({
          mode,
          currentAppId: appDetail.id,
          currentAppMode: mode,
        })}
    >
      <RiSparkling2Line className="mr-1 size-4" />
      {t('workflowGenerator.studioButton')}
    </Button>
  )
}

export default memo(GenerateTrigger)
