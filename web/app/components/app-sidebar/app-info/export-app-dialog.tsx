import type {
  AppDetailWithSite,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import {
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
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportAppDsl, useExportWorkflowAppDsl } from '@/app/components/app/use-export-app-dsl'

type ExportAppDialogContentProps = {
  appDetail: AppDetailWithSite
  onExported: () => void
}

export function ExportAppDialogContent(props: ExportAppDialogContentProps) {
  return (
    <AlertDialogContent backdropProps={{ forceRender: true }}>
      <ExportAppSession {...props} />
    </AlertDialogContent>
  )
}

function ExportAppSession({ appDetail, onExported }: ExportAppDialogContentProps) {
  const confirmLabelId = useId()
  const { t } = useTranslation(['workflow', 'common'])
  const [secrets, setSecrets] = useState<EnvironmentVariableItemResponse[]>([])
  const {
    exportWorkflowAppDsl,
    isExporting: isChecking,
    errorMessage: checkError,
  } = useExportWorkflowAppDsl()
  const { exportAppDsl, isExporting, errorMessage: exportError } = useExportAppDsl()
  const isPending = isChecking || isExporting
  const activeExportRef = useRef<AbortController | null>(null)
  useLayoutEffect(
    () => () => {
      activeExportRef.current?.abort()
      activeExportRef.current = null
    },
    [appDetail.id],
  )

  const runExport = async (includeSecret?: boolean) => {
    if (isPending || activeExportRef.current) return
    const controller = new AbortController()
    activeExportRef.current = controller
    const input = {
      appId: appDetail.id,
      appName: appDetail.name,
      feedback: 'dialog' as const,
      signal: controller.signal,
    }
    const result =
      includeSecret === undefined
        ? await exportWorkflowAppDsl(input)
        : await exportAppDsl({ ...input, includeSecret })
    if (controller.signal.aborted) return

    activeExportRef.current = null
    if (result.status === 'confirmation-required') setSecrets(result.secretEnvList)
    else if (result.status === 'downloaded') onExported()
  }

  if (secrets.length > 0)
    return (
      <ExportSecretsForm
        secrets={secrets}
        errorMessage={exportError}
        isPending={isPending}
        onSubmit={(includeSecret) => {
          void runExport(includeSecret)
        }}
      />
    )

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
      {checkError && (
        <AlertDialogBody>
          <p role="alert" className="system-sm-regular text-text-destructive">
            {checkError}
          </p>
        </AlertDialogBody>
      )}
      <AlertDialogFooter>
        <AlertDialogCancelButton>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          tone="default"
          loading={isPending}
          aria-labelledby={confirmLabelId}
          onClick={() => {
            void runExport()
          }}
        >
          <span id={confirmLabelId}>
            {isPending
              ? t(($) => $['operation.exporting'], { ns: 'common' })
              : t(($) => $['operation.confirm'], { ns: 'common' })}
          </span>
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </>
  )
}

function ExportSecretsForm({
  secrets,
  errorMessage,
  isPending,
  onSubmit,
}: {
  secrets: EnvironmentVariableItemResponse[]
  errorMessage?: string
  isPending: boolean
  onSubmit: (includeSecret: boolean) => void
}) {
  const { t } = useTranslation(['app', 'workflow', 'common'])
  const submitLabelId = useId()
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
              <th className="border-e border-b border-divider-regular p-2 text-start">
                {t(($) => $['env.export.name'], { ns: 'workflow' })}
              </th>
              <th className="border-b border-divider-regular p-2 text-start">
                {t(($) => $['env.export.value'], { ns: 'workflow' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {secrets.map((secret) => (
              <tr key={secret.name}>
                <td className="border-e border-divider-regular p-2 wrap-anywhere">{secret.name}</td>
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
        {errorMessage && (
          <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
            {errorMessage}
          </p>
        )}
      </AlertDialogBody>
      <AlertDialogFooter>
        <AlertDialogCancelButton type="button">
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          type="submit"
          tone="default"
          loading={isPending}
          aria-labelledby={submitLabelId}
        >
          <span id={submitLabelId}>
            {isPending
              ? t(($) => $['operation.exporting'], { ns: 'common' })
              : includeSecret
                ? t(($) => $['exportSecret.title'], { ns: 'app' })
                : t(($) => $.exportApp, { ns: 'app' })}
          </span>
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </Form>
  )
}
