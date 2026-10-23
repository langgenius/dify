'use client'

import type { KnowledgeFsGoldenQuestionBulkImportRowPayload } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ChangeEvent } from 'react'
import type { GoldenQuestionCsvError } from './golden-question-csv'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { useKnowledgeSpace } from '../space/context'
import {
  maxGoldenQuestionCsvBytes,
  maxGoldenQuestionCsvRows,
  parseGoldenQuestionCsv,
} from './golden-question-csv'
import { goldenQuestionQueriesKey } from './quality-model'

export function GoldenQuestionImportDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <GoldenQuestionImportSession onOpenChange={onOpenChange} />
    </Dialog>
  )
}

function GoldenQuestionImportSession({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation(['dataset', 'knowledgeQuality', 'knowledgeSpace'])
  const { space } = useKnowledgeSpace()
  const knowledgeSpaceId = space.control_space_id
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<KnowledgeFsGoldenQuestionBulkImportRowPayload[]>([])
  const [fileName, setFileName] = useState('')
  const [csvError, setCsvError] = useState<GoldenQuestionCsvError>()
  const [submitError, setSubmitError] = useState(false)
  const [reading, setReading] = useState(false)
  // Only the latest file selection may publish rows; earlier reads can resolve later.
  const readGenerationRef = useRef(0)
  const mutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.bulkImport.post.mutationOptions(),
  )
  const previewRows = (() => {
    const occurrences = new Map<string, number>()
    return rows.slice(0, 5).map((row) => {
      const fingerprint = JSON.stringify(row)
      const occurrence = occurrences.get(fingerprint) ?? 0
      occurrences.set(fingerprint, occurrence + 1)
      return { key: `${fingerprint}:${occurrence}`, row }
    })
  })()

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || mutation.isPending) return
    const generation = ++readGenerationRef.current
    setRows([])
    setFileName(file.name)
    setCsvError(undefined)
    setSubmitError(false)
    mutation.reset()
    if (file.size > maxGoldenQuestionCsvBytes) {
      setReading(false)
      setCsvError('size')
      return
    }
    setReading(true)
    let nextRows: KnowledgeFsGoldenQuestionBulkImportRowPayload[] = []
    let nextError: GoldenQuestionCsvError | undefined
    try {
      nextRows = parseGoldenQuestionCsv(await file.text())
    } catch (error) {
      const code = error instanceof Error ? error.message : 'parse'
      nextError = ['empty', 'headers', 'parse', 'required', 'tooManyRows'].includes(code)
        ? (code as GoldenQuestionCsvError)
        : 'parse'
    }
    if (generation !== readGenerationRef.current) return
    setRows(nextRows)
    setCsvError(nextError)
    setReading(false)
  }

  const submit = async () => {
    setSubmitError(false)
    try {
      await mutation.mutateAsync({
        body: { rows },
        params: { control_space_id: knowledgeSpaceId },
      })
      await queryClient.invalidateQueries({
        queryKey: goldenQuestionQueriesKey(knowledgeSpaceId),
      })
    } catch {
      setSubmitError(true)
    }
  }

  return (
    <DialogContent className="w-180">
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['qualityPage.importTitle'], { ns: 'knowledgeQuality' })}
        </DialogTitle>
        {!mutation.data && (
          <DialogDescription>
            {t(($) => $['qualityPage.importDescription'], { ns: 'knowledgeQuality' })}
          </DialogDescription>
        )}
        <DialogHeaderCloseButton
          aria-label={t(($) => $['qualityPage.closeDialog'], { ns: 'knowledgeQuality' })}
        />
      </DialogHeader>

      {mutation.data ? (
        <>
          <DialogBody>
            <div className="rounded-xl bg-background-section p-5">
              <p className="system-sm-semibold text-text-primary">
                {t(($) => $['qualityPage.importComplete'], { ns: 'knowledgeQuality' })}
              </p>
              <p className="mt-2 body-sm-regular text-text-secondary">
                {t(($) => $['qualityPage.importResult'], {
                  ns: 'knowledgeQuality',
                  active: mutation.data.active_count,
                  draft: mutation.data.draft_count,
                })}
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              {t(($) => $['qualityPage.closeDialog'], { ns: 'knowledgeQuality' })}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <DialogBody>
            <label
              htmlFor="golden-question-csv-file"
              aria-label={t(($) => $['qualityPage.chooseCsv'], { ns: 'knowledgeQuality' })}
              className="flex h-24 cursor-pointer items-center justify-center rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg text-center outline-hidden focus-within:ring-2 focus-within:ring-state-accent-solid"
            >
              <input
                id="golden-question-csv-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={mutation.isPending}
                onChange={readFile}
              />
              <span>
                <span
                  aria-hidden
                  className="mx-auto i-ri-file-excel-2-line block size-6 text-text-tertiary"
                />
                <span className="mt-2 block system-sm-medium text-text-secondary">
                  {fileName || t(($) => $['qualityPage.chooseCsv'], { ns: 'knowledgeQuality' })}
                </span>
              </span>
            </label>
            {csvError && (
              <p role="alert" className="mt-2 body-xs-regular text-text-destructive">
                {t(($) => $[`qualityPage.csvError.${csvError}`], {
                  ns: 'knowledgeQuality',
                  count: maxGoldenQuestionCsvRows,
                })}
              </p>
            )}
            {rows.length > 0 && (
              <div className="mt-5">
                <p className="system-xs-medium text-text-secondary">
                  {t(($) => $['qualityPage.previewRows'], {
                    ns: 'knowledgeQuality',
                    count: rows.length,
                  })}
                </p>
                <div className="mt-2 overflow-hidden rounded-lg border border-divider-subtle">
                  <div className="grid grid-cols-[1.2fr_1.5fr_1fr] gap-3 bg-background-section px-3 py-2 system-2xs-medium-uppercase text-text-tertiary">
                    <span>{t(($) => $['qualityPage.question'], { ns: 'knowledgeSpace' })}</span>
                    <span>{t(($) => $['qualityPage.evidence'], { ns: 'knowledgeSpace' })}</span>
                    <span>{t(($) => $['qualityPage.tags'], { ns: 'knowledgeQuality' })}</span>
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
                {t(($) => $.unknownError, { ns: 'dataset' })}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
              {t(($) => $['qualityPage.cancel'], { ns: 'knowledgeQuality' })}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={mutation.isPending}
              disabled={rows.length === 0 || reading}
              onClick={() => void submit()}
            >
              {t(($) => $['qualityPage.importCsv'], { ns: 'knowledgeQuality' })}
            </Button>
          </DialogFooter>
        </>
      )}
    </DialogContent>
  )
}
