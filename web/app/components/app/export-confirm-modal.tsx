'use client'
import type { EnvironmentVariableItemResponse } from '@dify/contracts/api/console/apps/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

type AppExportConfirmModalProps = {
  envList: Pick<EnvironmentVariableItemResponse, 'name' | 'value'>[]
  onConfirm: (includeSecret: boolean) => Promise<boolean>
  isExporting: boolean
  onClose: () => void
}

export const AppExportConfirmContent = ({
  envList,
  onConfirm,
  onClose,
  isExporting,
}: AppExportConfirmModalProps) => {
  const { t } = useTranslation(['app', 'workflow', 'common'])

  const [exportSecrets, setExportSecrets] = useState<boolean>(false)
  const exportButtonLabelId = React.useId()

  const submit = useCallback(async () => {
    if (isExporting) return

    if (await onConfirm(exportSecrets)) onClose()
  }, [exportSecrets, isExporting, onClose, onConfirm])

  return (
    <AlertDialogContent className="w-120">
      <div className="px-6 pt-6">
        <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['exportSecret.title'], { ns: 'app' })}
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-2 mb-6 system-sm-regular text-text-secondary">
          {t(($) => $['exportSecret.description'], { ns: 'app' })}
        </AlertDialogDescription>
        <div className="relative">
          <table className="w-full border-separate border-spacing-0 rounded-lg border border-divider-regular shadow-xs">
            <thead className="system-xs-medium-uppercase text-text-tertiary">
              <tr>
                <th className="h-7 w-55 border-r border-b border-divider-regular pl-3 text-left font-[weight:inherit]">
                  {t(($) => $['env.export.name'], { ns: 'workflow' })}
                </th>
                <th className="h-7 border-b border-divider-regular pl-3 text-left font-[weight:inherit]">
                  {t(($) => $['env.export.value'], { ns: 'workflow' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {envList.map((env, index) => (
                <tr key={env.name}>
                  <td
                    className={cn(
                      'h-7 border-r border-divider-regular pl-3 system-xs-medium',
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
                      'h-7 pl-3',
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
              'rounded-sm text-left system-sm-medium text-text-primary outline-hidden',
              isExporting && 'cursor-not-allowed opacity-50',
            )}
          >
            {t(($) => $['env.export.checkbox'], { ns: 'workflow' })}
          </span>
        </label>
      </div>
      <AlertDialogActions>
        <AlertDialogCancelButton disabled={isExporting}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          tone="default"
          loading={isExporting}
          aria-labelledby={exportButtonLabelId}
          onClick={submit}
        >
          <span id={exportButtonLabelId}>
            {isExporting
              ? t(($) => $['operation.exporting'], { ns: 'common' })
              : exportSecrets
                ? t(($) => $['exportSecret.title'], { ns: 'app' })
                : t(($) => $.exportApp, { ns: 'app' })}
          </span>
        </AlertDialogConfirmButton>
      </AlertDialogActions>
    </AlertDialogContent>
  )
}

const AppExportConfirmModal = (props: AppExportConfirmModalProps) => {
  const { envList, onClose, isExporting } = props
  const isDialogOpen = envList.length > 0

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open || isExporting) return

      onClose()
    },
    [isExporting, onClose],
  )

  return (
    <AlertDialog open={isDialogOpen} onOpenChange={handleOpenChange}>
      <AppExportConfirmContent {...props} />
    </AlertDialog>
  )
}

export default AppExportConfirmModal
