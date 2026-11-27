'use client'
import type { EnvironmentVariableItemResponse } from '@dify/contracts/api/console/apps/types.gen'
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
import { cn } from '@langgenius/dify-ui/cn'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ExportSecretsDialogContentProps = {
  envList: Pick<EnvironmentVariableItemResponse, 'name' | 'value'>[]
  isExporting: boolean
  errorMessage?: string
  onConfirm: (includeSecret: boolean) => void
}

export function ExportSecretsDialogContent(props: ExportSecretsDialogContentProps) {
  return (
    <AlertDialogContent>
      <ExportSecretsSession {...props} />
    </AlertDialogContent>
  )
}

export function ExportSecretsSession({
  envList,
  isExporting,
  errorMessage,
  onConfirm,
}: ExportSecretsDialogContentProps) {
  const { t } = useTranslation(['app', 'workflow', 'common'])
  const [exportSecrets, setExportSecrets] = useState(false)
  const exportButtonLabelId = useId()

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t(($) => $['exportSecret.title'], { ns: 'app' })}</AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => $['exportSecret.description'], { ns: 'app' })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogBody>
        <div className="relative">
          <table className="w-full border-separate border-spacing-0 rounded-lg border border-divider-regular shadow-xs">
            <thead className="system-xs-medium-uppercase text-text-tertiary">
              <tr>
                <th className="h-7 w-55 border-e border-b border-divider-regular ps-3 text-start font-[weight:inherit]">
                  {t(($) => $['env.export.name'], { ns: 'workflow' })}
                </th>
                <th className="h-7 border-b border-divider-regular ps-3 text-start font-[weight:inherit]">
                  {t(($) => $['env.export.value'], { ns: 'workflow' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {envList.map((env, index) => (
                <tr key={env.name}>
                  <td
                    className={cn(
                      'h-7 border-e border-divider-regular ps-3 system-xs-medium',
                      index + 1 !== envList.length && 'border-b border-divider-regular',
                    )}
                  >
                    <div className="flex w-50 items-center gap-1">
                      <span
                        aria-hidden="true"
                        className="i-custom-vender-line-others-env size-4 shrink-0 text-util-colors-violet-violet-600"
                      />
                      <div className="truncate text-text-primary">{env.name}</div>
                      <div className="shrink-0 text-text-tertiary">
                        {t(($) => $['env.export.secret'], { ns: 'workflow' })}
                      </div>
                      <span
                        aria-hidden="true"
                        className="i-ri-lock-2-line size-3 shrink-0 text-text-tertiary"
                      />
                    </div>
                  </td>
                  <td
                    className={cn(
                      'h-7 ps-3',
                      index + 1 !== envList.length && 'border-b border-divider-regular',
                    )}
                  >
                    <div className="truncate system-xs-regular text-text-secondary">
                      {typeof env.value === 'object'
                        ? JSON.stringify(env.value)
                        : String(env.value)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className={cn('mt-4 flex gap-2', !isExporting && 'cursor-pointer')}>
          <Checkbox
            className="shrink-0"
            checked={exportSecrets}
            disabled={isExporting}
            onCheckedChange={setExportSecrets}
          />
          <span
            className={cn(
              'rounded-sm text-start system-sm-medium text-text-primary outline-hidden',
              isExporting && 'cursor-not-allowed opacity-50',
            )}
          >
            {t(($) => $['env.export.checkbox'], { ns: 'workflow' })}
          </span>
        </label>
        {errorMessage && (
          <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
            {errorMessage}
          </p>
        )}
      </AlertDialogBody>
      <AlertDialogFooter>
        <AlertDialogCancelButton disabled={isExporting}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          tone="default"
          loading={isExporting}
          aria-labelledby={exportButtonLabelId}
          onClick={() => onConfirm(exportSecrets)}
        >
          <span id={exportButtonLabelId}>
            {isExporting
              ? t(($) => $['operation.exporting'], { ns: 'common' })
              : exportSecrets
                ? t(($) => $['exportSecret.title'], { ns: 'app' })
                : t(($) => $.exportApp, { ns: 'app' })}
          </span>
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </>
  )
}
