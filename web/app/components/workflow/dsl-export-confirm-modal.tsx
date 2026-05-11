'use client'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'

export type DSLExportConfirmModalProps = {
  envList: EnvironmentVariable[]
  onConfirm: (state: boolean) => void | Promise<void>
  onClose: () => void
}

type DSLExportConfirmContentProps = DSLExportConfirmModalProps & {
  onExportingChange?: (isExporting: boolean) => void
}

export const DSLExportConfirmContent = ({
  envList = [],
  onConfirm,
  onClose,
  onExportingChange,
}: DSLExportConfirmContentProps) => {
  const { t } = useTranslation()

  const [exportSecrets, setExportSecrets] = useState<boolean>(false)
  const [isExporting, setIsExporting] = useState(false)

  const submit = useCallback(async () => {
    if (isExporting)
      return

    setIsExporting(true)
    onExportingChange?.(true)
    try {
      await onConfirm(exportSecrets)
      onClose()
    }
    finally {
      setIsExporting(false)
      onExportingChange?.(false)
    }
  }, [exportSecrets, isExporting, onClose, onConfirm, onExportingChange])

  return (
    <AlertDialogContent className="w-120 max-w-120">
      <div className="px-6 pt-6">
        <AlertDialogTitle className="pb-6 title-2xl-semi-bold text-text-primary">
          {t('env.export.title', { ns: 'workflow' })}
        </AlertDialogTitle>
        <div className="relative">
          <table className="w-full border-separate border-spacing-0 rounded-lg border border-divider-regular shadow-xs">
            <thead className="system-xs-medium-uppercase text-text-tertiary">
              <tr>
                <td width={220} className="h-7 border-r border-b border-divider-regular pl-3">{t('env.export.name', { ns: 'workflow' })}</td>
                <td className="h-7 border-b border-divider-regular pl-3">{t('env.export.value', { ns: 'workflow' })}</td>
              </tr>
            </thead>
            <tbody>
              {envList.map((env, index) => (
                <tr key={env.name}>
                  <td className={cn('h-7 border-r border-divider-regular pl-3 system-xs-medium', index + 1 !== envList.length && 'border-b border-divider-regular')}>
                    <div className="flex w-50 items-center gap-1">
                      <span aria-hidden="true" className="i-custom-vender-line-others-env h-4 w-4 shrink-0 text-util-colors-violet-violet-600" />
                      <div className="truncate text-text-primary">{env.name}</div>
                      <div className="shrink-0 text-text-tertiary">{t('env.export.secret', { ns: 'workflow' })}</div>
                      <span aria-hidden="true" className="i-ri-lock-2-line h-3 w-3 shrink-0 text-text-tertiary" />
                    </div>
                  </td>
                  <td className={cn('h-7 pl-3', index + 1 !== envList.length && 'border-b border-divider-regular')}>
                    <div className="truncate system-xs-regular text-text-secondary">{env.value}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex gap-2">
          <Checkbox
            className="shrink-0"
            checked={exportSecrets}
            disabled={isExporting}
            onCheck={() => setExportSecrets(!exportSecrets)}
            ariaLabelledBy="dsl-export-secrets-checkbox-label"
          />
          <button
            id="dsl-export-secrets-checkbox-label"
            type="button"
            disabled={isExporting}
            className="cursor-pointer rounded-sm text-left system-sm-medium text-text-primary outline-hidden focus-visible:ring-1 focus-visible:ring-components-input-border-hover disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setExportSecrets(!exportSecrets)}
          >
            {t('env.export.checkbox', { ns: 'workflow' })}
          </button>
        </div>
      </div>
      <AlertDialogActions>
        <AlertDialogCancelButton disabled={isExporting}>
          {t('operation.cancel', { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          tone="default"
          loading={isExporting}
          disabled={isExporting}
          onClick={submit}
        >
          {isExporting
            ? t('operation.exporting', { ns: 'common' })
            : exportSecrets
              ? t('env.export.export', { ns: 'workflow' })
              : t('env.export.ignore', { ns: 'workflow' })}
        </AlertDialogConfirmButton>
      </AlertDialogActions>
    </AlertDialogContent>
  )
}

const DSLExportConfirmModal = (props: DSLExportConfirmModalProps) => {
  const { envList, onClose } = props
  const [isExporting, setIsExporting] = useState(false)
  const isDialogOpen = envList.length > 0

  const handleOpenChange = useCallback((open: boolean) => {
    if (open || isExporting)
      return

    onClose()
  }, [isExporting, onClose])

  return (
    <AlertDialog open={isDialogOpen} onOpenChange={handleOpenChange}>
      <DSLExportConfirmContent {...props} onExportingChange={setIsExporting} />
    </AlertDialog>
  )
}

export default DSLExportConfirmModal
