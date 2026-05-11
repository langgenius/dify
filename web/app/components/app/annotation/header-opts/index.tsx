'use client'
import type { FC } from 'react'
import type { AnnotationItemBasic } from '../type'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  jsonToCSV,
} from 'react-papaparse'
import { useLocale } from '@/context/i18n'

import { LanguagesSupported } from '@/i18n-config/language'
import { clearAllAnnotations, fetchExportAnnotationList } from '@/service/annotation'
import { downloadBlob } from '@/utils/download'
import AddAnnotationModal from '../add-annotation-modal'
import BatchAddModal from '../batch-add-annotation-modal'
import ClearAllAnnotationsConfirmModal from '../clear-all-annotations-confirm-modal'

const CSV_HEADER_QA_EN = ['Question', 'Answer']
const CSV_HEADER_QA_CN = ['问题', '答案']

type Props = {
  appId: string
  onAdd: (payload: AnnotationItemBasic) => void
  onAdded: () => void
  controlUpdateList: number
}

type OperationsMenuProps = {
  list: AnnotationItemBasic[]
  onClose: () => void
  onBulkImport: () => void
  onClearAll: () => void
  onExportJsonl: () => void
}

const buildAnnotationJsonlRecords = (list: AnnotationItemBasic[]) => list.map(
  (item: AnnotationItemBasic) => {
    return `{"messages": [{"role": "system", "content": ""}, {"role": "user", "content": ${JSON.stringify(item.question)}}, {"role": "assistant", "content": ${JSON.stringify(item.answer)}}]}`
  },
)

const downloadAnnotationJsonl = (list: AnnotationItemBasic[], locale: string) => {
  const content = buildAnnotationJsonlRecords(list).join('\n')
  const file = new Blob([content], { type: 'application/jsonl' })
  downloadBlob({ data: file, fileName: `annotations-${locale}.jsonl` })
}

const downloadAnnotationCsv = (list: AnnotationItemBasic[], locale: string) => {
  const content = jsonToCSV([
    locale !== LanguagesSupported[1] ? CSV_HEADER_QA_EN : CSV_HEADER_QA_CN,
    ...list.map(item => [item.question, item.answer]),
  ])
  const file = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' })
  downloadBlob({ data: file, fileName: `annotations-${locale}.csv` })
}

const OperationsMenu: FC<OperationsMenuProps> = ({
  list,
  onClose,
  onBulkImport,
  onClearAll,
  onExportJsonl,
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const annotationUnavailable = list.length === 0

  return (
    <>
      <DropdownMenuItem
        className="gap-2"
        onClick={() => {
          onClose()
          onBulkImport()
        }}
      >
        <span aria-hidden className="i-custom-vender-line-files-file-plus-02 size-4 shrink-0 text-text-tertiary" />
        {t('table.header.bulkImport', { ns: 'appAnnotation' })}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <span aria-hidden className="i-custom-vender-line-files-file-download-02 size-4 shrink-0 text-text-tertiary" />
          {t('table.header.bulkExport', { ns: 'appAnnotation' })}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          placement="left-start"
          sideOffset={4}
          popupClassName="min-w-[100px]"
        >
          <DropdownMenuItem
            disabled={annotationUnavailable}
            onClick={() => {
              onClose()
              downloadAnnotationCsv(list, locale)
            }}
          >
            CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={annotationUnavailable}
            onClick={() => {
              onClose()
              onExportJsonl()
            }}
          >
            JSONL
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        variant="destructive"
        className="gap-2"
        onClick={() => {
          onClose()
          onClearAll()
        }}
      >
        <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
        {t('table.header.clearAll', { ns: 'appAnnotation' })}
      </DropdownMenuItem>
    </>
  )
}

const HeaderOptions: FC<Props> = ({
  appId,
  onAdd,
  onAdded,
  controlUpdateList,
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const [list, setList] = useState<AnnotationItemBasic[]>([])

  const fetchList = React.useCallback(async () => {
    const { data }: any = await fetchExportAnnotationList(appId)
    setList(data as AnnotationItemBasic[])
  }, [appId])

  useEffect(() => {
    fetchList()
  }, [fetchList])
  useEffect(() => {
    if (controlUpdateList)
      fetchList()
  }, [controlUpdateList, fetchList])

  const [showBulkImportModal, setShowBulkImportModal] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [isOperationsMenuOpen, setIsOperationsMenuOpen] = useState(false)
  const handleShowBulkImportModal = React.useCallback(() => {
    setShowBulkImportModal(true)
  }, [])
  const handleClearAll = React.useCallback(() => {
    setShowClearConfirm(true)
  }, [])
  const handleExportJsonl = React.useCallback(() => {
    downloadAnnotationJsonl(list, locale)
  }, [list, locale])
  const handleConfirmed = async () => {
    try {
      await clearAllAnnotations(appId)
      onAdded()
    }
    catch (e) {
      console.error(`failed to clear all annotations, ${e}`)
    }
    finally {
      setShowClearConfirm(false)
    }
  }

  const [showAddModal, setShowAddModal] = React.useState(false)

  return (
    <div className="flex space-x-2">
      <Button variant="primary" onClick={() => setShowAddModal(true)}>
        <span aria-hidden className="mr-0.5 i-ri-add-line h-4 w-4" />
        <div>{t('table.header.addAnnotation', { ns: 'appAnnotation' })}</div>
      </Button>
      <DropdownMenu modal={false} open={isOperationsMenuOpen} onOpenChange={setIsOperationsMenuOpen}>
        <DropdownMenuTrigger
          aria-label={t('operation.more', { ns: 'common' })}
          className="mr-0 box-border inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-0 text-components-button-secondary-text shadow-xs backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover data-popup-open:border-components-button-secondary-border-hover data-popup-open:bg-components-button-secondary-bg-hover"
        >
          <span aria-hidden className="i-ri-more-fill h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="w-[155px]"
        >
          <OperationsMenu
            list={list}
            onClose={() => setIsOperationsMenuOpen(false)}
            onBulkImport={handleShowBulkImportModal}
            onClearAll={handleClearAll}
            onExportJsonl={handleExportJsonl}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {showAddModal && (
        <AddAnnotationModal
          isShow={showAddModal}
          onHide={() => setShowAddModal(false)}
          onAdd={onAdd}
        />
      )}

      {
        showBulkImportModal && (
          <BatchAddModal
            appId={appId}
            isShow={showBulkImportModal}
            onCancel={() => setShowBulkImportModal(false)}
            onAdded={onAdded}
          />
        )
      }
      {
        showClearConfirm && (
          <ClearAllAnnotationsConfirmModal
            isShow={showClearConfirm}
            onHide={() => setShowClearConfirm(false)}
            onConfirm={handleConfirmed}
          />
        )
      }
    </div>
  )
}
export default React.memo(HeaderOptions)
