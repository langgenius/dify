import type {
  AppDetailWithSite,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import {
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useId, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportWorkflowAppDsl } from '@/app/components/app/use-export-app-dsl'

type ExportAppWarningProps = {
  appDetail: AppDetailWithSite
  onSecretsRequired: (envList: EnvironmentVariableItemResponse[]) => void
  onExported: () => void
}

export function ExportAppWarning({
  appDetail,
  onSecretsRequired,
  onExported,
}: ExportAppWarningProps) {
  const confirmLabelId = useId()
  const { t } = useTranslation(['workflow', 'common'])
  const { exportWorkflowAppDsl, isExporting, errorMessage } = useExportWorkflowAppDsl()
  const activeExportRef = useRef<AbortController | null>(null)
  useLayoutEffect(
    () => () => {
      activeExportRef.current?.abort()
      activeExportRef.current = null
    },
    [appDetail.id],
  )

  const runExport = async () => {
    if (isExporting || activeExportRef.current) return
    const controller = new AbortController()
    activeExportRef.current = controller
    const result = await exportWorkflowAppDsl({
      appId: appDetail.id,
      appName: appDetail.name,
      feedback: 'dialog',
      signal: controller.signal,
    })
    if (controller.signal.aborted) return

    activeExportRef.current = null
    if (result.status === 'confirmation-required') onSecretsRequired(result.secretEnvList)
    else if (result.status === 'downloaded') onExported()
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t(($) => $['sidebar.exportWarning'], { ns: 'workflow' })}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => $['sidebar.exportWarningDesc'], { ns: 'workflow' })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {errorMessage && (
        <AlertDialogBody>
          <p role="alert" className="system-sm-regular text-text-destructive">
            {errorMessage}
          </p>
        </AlertDialogBody>
      )}
      <AlertDialogFooter>
        <AlertDialogCancelButton>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          tone="default"
          loading={isExporting}
          aria-labelledby={confirmLabelId}
          onClick={() => {
            void runExport()
          }}
        >
          <span id={confirmLabelId}>
            {isExporting
              ? t(($) => $['operation.exporting'], { ns: 'common' })
              : t(($) => $['operation.confirm'], { ns: 'common' })}
          </span>
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </>
  )
}
