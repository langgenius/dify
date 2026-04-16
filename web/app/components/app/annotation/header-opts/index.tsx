'use client'
import type { FC } from 'react'
import type { AnnotationItemBasic } from '../type'
import { Menu, MenuButton, MenuItems, Transition } from '@headlessui/react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { Button } from '@/app/components/base/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
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

const OperationsMenu: FC<OperationsMenuProps> = ({
  list,
  onClose,
  onBulkImport,
  onClearAll,
  onExportJsonl,
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const { CSVDownloader, Type } = useCSVDownloader()
  const annotationUnavailable = list.length === 0

  return (
    <div className="w-full py-1">
      <button
        type="button"
        className="mx-1 flex h-9 w-[calc(100%-8px)] cursor-pointer items-center space-x-2 rounded-lg px-3 py-2 hover:bg-components-panel-on-panel-item-bg-hover disabled:opacity-50"
        onClick={() => {
          onClose()
          onBulkImport()
        }}
      >
        <span aria-hidden className="i-custom-vender-line-files-file-plus-02 h-4 w-4 text-text-tertiary" />
        <span className="grow text-left system-sm-regular text-text-secondary">{t('table.header.bulkImport', { ns: 'appAnnotation' })}</span>
      </button>
      <Menu as="div" className="relative h-full w-full">
        <MenuButton className="mx-1 flex h-9 w-[calc(100%-8px)] cursor-pointer items-center space-x-2 rounded-lg px-3 py-2 hover:bg-components-panel-on-panel-item-bg-hover disabled:opacity-50">
          <span aria-hidden className="i-custom-vender-line-files-file-download-02 h-4 w-4 text-text-tertiary" />
          <span className="grow text-left system-sm-regular text-text-secondary">{t('table.header.bulkExport', { ns: 'appAnnotation' })}</span>
          <span aria-hidden className="i-custom-vender-line-arrows-chevron-right h-[14px] w-[14px] shrink-0 text-text-tertiary" />
        </MenuButton>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <MenuItems
            className={cn(
              'absolute top-px left-1 z-10 min-w-[100px] origin-top-right -translate-x-full rounded-xl border-[0.5px] border-components-panel-on-panel-item-bg bg-components-panel-bg py-1 shadow-xs',
            )}
          >
            <CSVDownloader
              type={Type.Link}
              filename={`annotations-${locale}`}
              bom={true}
              data={[
                locale !== LanguagesSupported[1] ? CSV_HEADER_QA_EN : CSV_HEADER_QA_CN,
                ...list.map(item => [item.question, item.answer]),
              ]}
            >
              <button
                type="button"
                disabled={annotationUnavailable}
                className="mx-1 flex h-9 w-[calc(100%-8px)] cursor-pointer items-center space-x-2 rounded-lg px-3 py-2 hover:bg-components-panel-on-panel-item-bg-hover disabled:opacity-50"
                onClick={onClose}
              >
                <span className="grow text-left system-sm-regular text-text-secondary">CSV</span>
              </button>
            </CSVDownloader>
            <button
              type="button"
              disabled={annotationUnavailable}
              className={cn('mx-1 flex h-9 w-[calc(100%-8px)] cursor-pointer items-center space-x-2 rounded-lg px-3 py-2 hover:bg-components-panel-on-panel-item-bg-hover disabled:opacity-50', 'border-0!')}
              onClick={() => {
                onClose()
                onExportJsonl()
              }}
            >
              <span className="grow text-left system-sm-regular text-text-secondary">JSONL</span>
            </button>
          </MenuItems>
        </Transition>
      </Menu>
      <button
        type="button"
        onClick={() => {
          onClose()
          onClearAll()
        }}
        className="mx-1 flex h-9 w-[calc(100%-8px)] cursor-pointer items-center space-x-2 rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        <span aria-hidden className="i-ri-delete-bin-line h-4 w-4" />
        <span className="grow text-left system-sm-regular">
          {t('table.header.clearAll', { ns: 'appAnnotation' })}
        </span>
      </button>
    </div>
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
      <DropdownMenu open={isOperationsMenuOpen} onOpenChange={setIsOperationsMenuOpen}>
        <DropdownMenuTrigger
          aria-label={t('operation.more', { ns: 'common' })}
          className="mr-0 box-border inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-0 text-components-button-secondary-text shadow-xs backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover data-popup-open:border-components-button-secondary-border-hover data-popup-open:bg-components-button-secondary-bg-hover"
        >
          <span aria-hidden className="i-ri-more-fill h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="w-[155px] overflow-visible py-0"
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
