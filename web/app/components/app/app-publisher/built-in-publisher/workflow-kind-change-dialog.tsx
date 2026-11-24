import type { WorkflowKind } from '@/types/workflow'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

type WorkflowKindChangeDialogProps = {
  /** The kind the workflow switches to; null keeps the dialog closed. */
  targetKind: WorkflowKind | null
  onCancel: () => void
  onConfirm: (targetKind: WorkflowKind) => void
}

// Lives beside the publish popover, not inside it, so the popover can close while this asks.
export function WorkflowKindChangeDialog({
  targetKind,
  onCancel,
  onConfirm,
}: WorkflowKindChangeDialogProps) {
  const { t } = useTranslation(['common', 'workflow'])
  const docLink = useDocLink()
  const toStandard = targetKind === 'standard'
  const title = toStandard
    ? t(($) => $['common.switchToStandardWorkflow'], { ns: 'workflow' })
    : t(($) => $['common.switchToEvaluationWorkflow'], { ns: 'workflow' })

  return (
    <AlertDialog
      open={targetKind !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {toStandard ? (
              t(($) => $['common.switchToStandardWorkflowDescription'], { ns: 'workflow' })
            ) : (
              <>
                {t(($) => $['common.evaluationWorkflowDescription'], { ns: 'workflow' })}{' '}
                <a
                  className="rounded-sm text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                  href={docLink(
                    '/use-dify/evaluate/custom-evaluators#publish-it-as-an-evaluation-workflow',
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t(($) => $['operation.learnMore'])}
                </a>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton>{t(($) => $['operation.cancel'])}</AlertDialogCancelButton>
          <AlertDialogConfirmButton
            tone="default"
            onClick={() => {
              if (targetKind) onConfirm(targetKind)
            }}
          >
            {t(($) => $['operation.confirm'])}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
