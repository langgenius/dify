'use client'

import type { KnowledgeFsGoldenQuestionBulkImportRowPayload } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ChangeEvent } from 'react'
import type { GoldenQuestionCsvError } from './golden-question-csv'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import {
  maxGoldenQuestionCsvBytes,
  maxGoldenQuestionCsvRows,
  parseGoldenQuestionCsv,
} from './golden-question-csv'

export function GoldenQuestionImportDialog({
  knowledgeSpaceId,
  onImported,
  onOpenChange,
  open,
}: {
  knowledgeSpaceId: string
  onImported: () => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useTranslation('dataset')
  const [rows, setRows] = useState<KnowledgeFsGoldenQuestionBulkImportRowPayload[]>([])
  const [fileName, setFileName] = useState('')
  const [csvError, setCsvError] = useState<GoldenQuestionCsvError>()
  const [submitError, setSubmitError] = useState(false)
  const mutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.bulkImport.post.mutationOptions(),
  )
  const previewRows = useMemo(() => {
    const occurrences = new Map<string, number>()
    return rows.slice(0, 5).map((row) => {
      const fingerprint = JSON.stringify(row)
      const occurrence = occurrences.get(fingerprint) ?? 0
      occurrences.set(fingerprint, occurrence + 1)
      return { key: `${fingerprint}:${occurrence}`, row }
    })
  }, [rows])

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setCsvError(undefined)
    setSubmitError(false)
    mutation.reset()
    if (file.size > maxGoldenQuestionCsvBytes) {
      setRows([])
      setFileName(file.name)
      setCsvError('size')
      return
    }
    try {
      setRows(parseGoldenQuestionCsv(await file.text()))
      setFileName(file.name)
    } catch (error) {
      const code = error instanceof Error ? error.message : 'parse'
      setRows([])
      setFileName(file.name)
      setCsvError(
        ['empty', 'headers', 'parse', 'required', 'tooManyRows'].includes(code)
          ? (code as GoldenQuestionCsvError)
          : 'parse',
      )
    }
  }

  const submit = async () => {
    setSubmitError(false)
    try {
      await mutation.mutateAsync({
        body: { rows },
        params: { control_space_id: knowledgeSpaceId },
      })
      await onImported()
    } catch {
      setSubmitError(true)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop className="bg-[rgba(16,24,40,0.2)]" />
        <DialogPopup className="fixed top-1/2 left-1/2 max-h-[calc(100vh-2rem)] w-180 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border-0 p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <DialogTitle className="system-md-semibold text-text-primary">
              {t(($) => $['newKnowledge.qualityPage.importTitle'])}
            </DialogTitle>
            <DialogClose
              render={
                <IconButton
                  aria-label={t(($) => $['newKnowledge.qualityPage.closeDialog'])}
                  className="static size-5"
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
          </div>

          {mutation.data ? (
            <div className="mt-6">
              <div className="rounded-xl bg-background-section p-5">
                <p className="system-sm-semibold text-text-primary">
                  {t(($) => $['newKnowledge.qualityPage.importComplete'])}
                </p>
                <p className="mt-2 body-sm-regular text-text-secondary">
                  {t(($) => $['newKnowledge.qualityPage.importResult'], {
                    active: mutation.data.active_count,
                    draft: mutation.data.draft_count,
                  })}
                </p>
              </div>
              <div className="mt-6 flex justify-end">
                <Button variant="primary" onClick={() => onOpenChange(false)}>
                  {t(($) => $['newKnowledge.qualityPage.closeDialog'])}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-2 body-xs-regular text-text-tertiary">
                {t(($) => $['newKnowledge.qualityPage.importDescription'])}
              </p>
              <label
                htmlFor="golden-question-csv-file"
                aria-label={t(($) => $['newKnowledge.qualityPage.chooseCsv'])}
                className="mt-5 flex h-24 cursor-pointer items-center justify-center rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg text-center outline-hidden focus-within:ring-2 focus-within:ring-state-accent-solid"
              >
                <input
                  id="golden-question-csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={readFile}
                />
                <span>
                  <span
                    aria-hidden
                    className="mx-auto i-ri-file-excel-2-line block size-6 text-text-tertiary"
                  />
                  <span className="mt-2 block system-sm-medium text-text-secondary">
                    {fileName || t(($) => $['newKnowledge.qualityPage.chooseCsv'])}
                  </span>
                </span>
              </label>
              {csvError && (
                <p role="alert" className="mt-2 body-xs-regular text-text-destructive">
                  {t(($) => $[`newKnowledge.qualityPage.csvError.${csvError}`], {
                    count: maxGoldenQuestionCsvRows,
                  })}
                </p>
              )}
              {rows.length > 0 && (
                <div className="mt-5">
                  <p className="system-xs-medium text-text-secondary">
                    {t(($) => $['newKnowledge.qualityPage.previewRows'], { count: rows.length })}
                  </p>
                  <div className="mt-2 overflow-hidden rounded-lg border border-divider-subtle">
                    <div className="grid grid-cols-[1.2fr_1.5fr_1fr] gap-3 bg-background-section px-3 py-2 system-2xs-medium-uppercase text-text-tertiary">
                      <span>{t(($) => $['newKnowledge.qualityPage.question'])}</span>
                      <span>{t(($) => $['newKnowledge.qualityPage.evidence'])}</span>
                      <span>{t(($) => $['newKnowledge.qualityPage.tags'])}</span>
                    </div>
                    {previewRows.map(({ key, row }) => (
                      <div
                        key={key}
                        className="grid grid-cols-[1.2fr_1.5fr_1fr] gap-3 border-t border-divider-subtle px-3 py-2 body-xs-regular text-text-secondary"
                      >
                        <span className="truncate">{row.question}</span>
                        <span className="truncate">{row.evidence}</span>
                        <span className="truncate">{row.tags?.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {submitError && (
                <p role="alert" className="mt-3 body-xs-regular text-text-destructive">
                  {t(($) => $.unknownError)}
                </p>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <Button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => onOpenChange(false)}
                >
                  {t(($) => $['newKnowledge.qualityPage.cancel'])}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  loading={mutation.isPending}
                  disabled={rows.length === 0 || mutation.isPending}
                  onClick={() => void submit()}
                >
                  {t(($) => $['newKnowledge.qualityPage.importCsv'])}
                </Button>
              </div>
            </>
          )}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
