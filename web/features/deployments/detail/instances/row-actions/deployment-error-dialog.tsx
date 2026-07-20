'use client'

import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useTranslation } from 'react-i18next'

function DeploymentErrorDetails({ error }: { error?: EnvironmentDeployment['error'] }) {
  const { t } = useTranslation('deployments')
  const message = error?.message?.trim() || t(($) => $['deployTab.panel.unknownError'])
  const metadata = [
    ...(error?.phase ? [{ label: t(($) => $['deployTab.errorPhase']), value: error.phase }] : []),
    ...(error?.code ? [{ label: t(($) => $['deployTab.errorCode']), value: error.code }] : []),
  ]

  return (
    <div className="rounded-xl border border-divider-subtle bg-background-default-subtle p-3">
      <div className="system-xs-medium-uppercase text-text-tertiary">
        {t(($) => $['deployTab.errorMessage'])}
      </div>
      <div className="mt-1 system-sm-regular break-words whitespace-pre-wrap text-text-secondary">
        {message}
      </div>
      {metadata.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {metadata.map((item) => (
            <span
              key={item.label}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-divider-subtle bg-background-default px-2 py-1 system-xs-regular text-text-tertiary"
            >
              <span className="shrink-0 text-text-quaternary">{item.label}</span>
              <span className="truncate font-mono text-text-secondary">{item.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function DeploymentErrorDialog({
  open,
  row,
  onOpenChange,
}: {
  open: boolean
  row: EnvironmentDeployment
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-120">
        <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['deployTab.errorDialogTitle'], { name: row.environment.displayName })}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-sm-regular text-text-tertiary">
            {t(($) => $['deployTab.errorDialogDesc'])}
          </AlertDialogDescription>
          <DeploymentErrorDetails error={row.error} />
        </div>
        <AlertDialogActions className="pt-3">
          <AlertDialogCancelButton variant="secondary">
            {t(($) => $['deployTab.closeError'])}
          </AlertDialogCancelButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
