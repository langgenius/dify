import type { AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agent/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'

type AgentVersionRestoreDialogsProps = {
  version: AgentConfigSnapshotSummaryResponse | null
  isUpgradeOpen: boolean
  onUpgradeClose: () => void
  isConfirmOpen: boolean
  onConfirmOpenChange: (open: boolean) => void
  isPending: boolean
  disabled: boolean
  onConfirm: () => void
}

export function AgentVersionRestoreDialogs({
  version,
  isUpgradeOpen,
  onUpgradeClose,
  isConfirmOpen,
  onConfirmOpenChange,
  isPending,
  disabled,
  onConfirm,
}: AgentVersionRestoreDialogsProps) {
  const { t } = useTranslation('agentV2')
  const versionLabel = version
    ? version.version_note ||
      t(($) => $['agentDetail.versionHistory.versionName'], { version: version.version })
    : ''

  return (
    <>
      <PlanUpgradeModal
        show={isUpgradeOpen}
        onClose={onUpgradeClose}
        title={t(($) => $['upgrade.agentRestore.title'], { ns: 'billing' })}
        description={t(($) => $['upgrade.agentRestore.description'], { ns: 'billing' })}
      />
      <AlertDialog open={isConfirmOpen} onOpenChange={onConfirmOpenChange}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 p-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {`${t(($) => $['agentDetail.versionHistory.restore'])} ${versionLabel}`}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-md-regular text-text-secondary">
              {t(($) => $['versionHistory.restorationTip'], { ns: 'workflow' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary" disabled={isPending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="default"
              disabled={disabled}
              loading={isPending}
              onClick={onConfirm}
            >
              {t(($) => $['agentDetail.versionHistory.restore'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
