import type {
  AppDetailWithSite,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { AlertDialogActions, AlertDialogProps } from '@langgenius/dify-ui/alert-dialog'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportAppDsl, useExportWorkflowAppDsl } from '@/app/components/app/use-export-app-dsl'

type ExportAppDialogProps = Pick<AlertDialogProps, 'open' | 'onOpenChange'> & {
  appDetail: AppDetailWithSite
}

export function ExportAppDialog({ appDetail, open, onOpenChange }: ExportAppDialogProps) {
  const actionsRef = useRef<AlertDialogActions>(null)
  const { t } = useTranslation(['workflow', 'common'])
  const [secrets, setSecrets] = useState<EnvironmentVariableItemResponse[]>([])
  const { exportWorkflowAppDsl, isExporting: isChecking } = useExportWorkflowAppDsl()
  const { exportAppDsl, isExporting } = useExportAppDsl()
  const isPending = isChecking || isExporting
  const check = async () => {
    if (isPending) return
    const result = await exportWorkflowAppDsl({ appId: appDetail.id, appName: appDetail.name })
    if (result.status === 'confirmation-required') setSecrets(result.secretEnvList)
    else if (result.status === 'downloaded') actionsRef.current?.close()
  }
  const download = async (includeSecret: boolean) => {
    if (isPending) return
    const result = await exportAppDsl({
      appId: appDetail.id,
      appName: appDetail.name,
      includeSecret,
    })
    if (result.status === 'downloaded') actionsRef.current?.close()
  }
  return (
    <AlertDialog
      actionsRef={actionsRef}
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isPending && details.reason !== 'imperative-action') details.cancel()
        else onOpenChange?.(nextOpen, details)
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setSecrets([])
      }}
    >
      <AlertDialogContent backdropProps={{ forceRender: true }}>
        {secrets.length > 0 ? (
          <ExportSecretsForm
            secrets={secrets}
            isPending={isPending}
            onSubmit={(includeSecret) => {
              void download(includeSecret)
            }}
          />
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(($) => $['sidebar.exportWarning'], { ns: 'workflow' })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(($) => $['sidebar.exportWarningDesc'], { ns: 'workflow' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton disabled={isPending}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                tone="default"
                loading={isPending}
                onClick={() => {
                  void check()
                }}
              >
                {isPending
                  ? t(($) => $['operation.exporting'], { ns: 'common' })
                  : t(($) => $['operation.confirm'], { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ExportSecretsForm({
  secrets,
  isPending,
  onSubmit,
}: {
  secrets: EnvironmentVariableItemResponse[]
  isPending: boolean
  onSubmit: (includeSecret: boolean) => void
}) {
  const { t } = useTranslation(['app', 'workflow', 'common'])
  const [includeSecret, setIncludeSecret] = useState(false)
  return (
    <Form
      className="contents"
      onFormSubmit={() => {
        if (!isPending) onSubmit(includeSecret)
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t(($) => $['exportSecret.title'], { ns: 'app' })}</AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => $['exportSecret.description'], { ns: 'app' })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogBody>
        <table className="w-full table-fixed border-separate border-spacing-0 rounded-lg border border-divider-regular shadow-xs">
          <thead>
            <tr>
              <th className="border-r border-b border-divider-regular p-2 text-left">
                {t(($) => $['env.export.name'], { ns: 'workflow' })}
              </th>
              <th className="border-b border-divider-regular p-2 text-left">
                {t(($) => $['env.export.value'], { ns: 'workflow' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {secrets.map((secret) => (
              <tr key={secret.name}>
                <td className="border-r border-divider-regular p-2 wrap-anywhere">{secret.name}</td>
                <td className="p-2 wrap-anywhere">
                  {typeof secret.value === 'object'
                    ? JSON.stringify(secret.value)
                    : String(secret.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Field name="include_secret" className="mt-4">
          <FieldLabel className="flex items-center gap-2">
            <Checkbox
              checked={includeSecret}
              onCheckedChange={setIncludeSecret}
              disabled={isPending}
            />
            {t(($) => $['env.export.checkbox'], { ns: 'workflow' })}
          </FieldLabel>
        </Field>
      </AlertDialogBody>
      <AlertDialogFooter>
        <AlertDialogCancelButton type="button" disabled={isPending}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton type="submit" tone="default" loading={isPending}>
          {isPending
            ? t(($) => $['operation.exporting'], { ns: 'common' })
            : includeSecret
              ? t(($) => $['exportSecret.title'], { ns: 'app' })
              : t(($) => $.exportApp, { ns: 'app' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </Form>
  )
}
