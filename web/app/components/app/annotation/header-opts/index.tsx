'use client'
import type { FC } from 'react'
import React, { Fragment, useEffect, useState } from 'react'
import ClearAllAnnotationsConfirmModal from '../clear-all-annotations-confirm-modal'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiMoreFill,
} from '@remixicon/react'
import { useContext } from 'use-context-selector'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { Menu, MenuButton, MenuItems, Transition } from '@headlessui/react'
import Button from '../../../base/button'
import AddAnnotationModal from '../add-annotation-modal'
import type { AnnotationItemBasic } from '../type'
import BatchAddModal from '../batch-add-annotation-modal'
import cn from '@/utils/classnames'
import CustomPopover from '@/app/components/base/popover'
import { FileDownload02, FilePlus02 } from '@/app/components/base/icons/src/vender/line/files'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'

import I18n from '@/context/i18n'
import { fetchExportAnnotationList } from '@/service/annotation'
import { clearAllAnnotations } from '@/service/annotation'
import { LanguagesSupported } from '@/i18n-config/language'

const CSV_HEADER_QA_EN = ['Question', 'Answer']
const CSV_HEADER_QA_CN = ['问题', '答案']

type Props = {
  appId: string
  onAdd: (payload: AnnotationItemBasic) => void
  onAdded: () => void
  controlUpdateList: number
}

const HeaderOptions: FC<Props> = ({
  appId,
  onAdd,
  onAdded,
  controlUpdateList,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const { CSVDownloader, Type } = useCSVDownloader()
  const [list, setList] = useState<AnnotationItemBasic[]>([])
  const annotationUnavailable = list.length === 0

  const listTransformer = (list: AnnotationItemBasic[]) => list.map(
    (item: AnnotationItemBasic) => {
      const dataString = `{"messages": [{"role": "system", "content": ""}, {"role": "user", "content": ${JSON.stringify(item.question)}}, {"role": "assistant", "content": ${JSON.stringify(item.answer)}}]}`
      return dataString
    },
  )

  const JSONLOutput = () => {
    const a = document.createElement('a')
    const content = listTransformer(list).join('\n')
    const file = new Blob([content], { type: 'application/jsonl' })
    const url = URL.createObjectURL(file)
    a.href = url
    a.download = `annotations-${locale}.jsonl`
    a.click()
    URL.revokeObjectURL(url)
  }

  const fetchList = async () => {
    const { data }: any = await fetchExportAnnotationList(appId)
    setList(data as AnnotationItemBasic[])
  }

  useEffect(() => {
    fetchList()
  }, [])
  useEffect(() => {
    if (controlUpdateList)
      fetchList()
  }, [controlUpdateList])

  const [showBulkImportModal, setShowBulkImportModal] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const handleClearAll = () => {
    setShowClearConfirm(true)
  }
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
  const Operations = () => {
    return (
      <div className="w-full py-1">
        <button type="button" className='mx-1 flex h-9 w-[calc(100%_-_8px)] cursor-pointer items-center space-x-2 rounded-lg px-3 py-2 hover:bg-components-panel-on-panel-item-bg-hover disabled:opacity-50' onClick={() => {
          setShowBulkImportModal(true)
        }}>
          <FilePlus02 className='h-4 w-4 text-text-tertiary' />
          <span className='system-sm-regular grow text-left text-text-secondary'>{t('appAnnotation.table.header.bulkImport')}</span>
        </button>
        <Menu as="div" className="relative h-full w-full">
          <MenuButton className='mx-1 flex h-9 w-[calc(100%_-_8px)] cursor-pointer items-center space-x-2 rounded-lg px-3 py-2 hover:bg-components-panel-on-panel-item-bg-hover disabled:opacity-50'>
            <FileDownload02 className='h-4 w-4 text-text-tertiary' />
            <span className='system-sm-regular grow text-left text-text-secondary'>{t('appAnnotation.table.header.bulkExport')}</span>
            <ChevronRight className='h-[14px] w-[14px] shrink-0 text-text-tertiary' />
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
                'absolute left-1 top-[1px] z-10 min-w-[100px] origin-top-right -translate-x-full rounded-xl border-[0.5px] border-components-panel-on-panel-item-bg bg-components-panel-bg py-1 shadow-xs',
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
                <button type="button" disabled={annotationUnavailable} className='mx-1 flex h-9 w-[calc(100%_-_8px)] cursor-pointer items-center space-x-2 rounded-lg px-3 py-2 hover:bg-components-panel-on-panel-item-bg-hover disabled:opacity-50'>
                  <span className='system-sm-regular grow text-left text-text-secondary'>CSV</span>
                </button>
              </CSVDownloader>
              <button type="button" disabled={annotationUnavailable} className={cn('mx-1 flex h-9 w-[calc(100%_-_8px)] cursor-pointer items-center space-x-2 rounded-lg px-3 py-2 hover:bg-components-panel-on-panel-item-bg-hover disabled:opacity-50', '!border-0')} onClick={JSONLOutput}>
                <span className='system-sm-regular grow text-left text-text-secondary'>JSONL</span>
              </button>
            </MenuItems>
          </Transition>
        </Menu>
        <button type="button"
          onClick={handleClearAll}
          className='mx-1 flex h-9 w-[calc(100%_-_8px)] cursor-pointer items-center space-x-2 rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50'
        >
          <RiDeleteBinLine className='h-4 w-4' />
          <span className='system-sm-regular grow text-left'>
            {t('appAnnotation.table.header.clearAll')}
          </span>
        </button>
      </div>
    )
  }

  const [showAddModal, setShowAddModal] = React.useState(false)

  return (
    <div className='flex space-x-2'>
      <Button variant='primary' onClick={() => setShowAddModal(true)}>
        <RiAddLine className='mr-0.5 h-4 w-4' />
        <div>{t('appAnnotation.table.header.addAnnotation')}</div>
      </Button>
      <CustomPopover
        htmlContent={<Operations />}
        position="br"
        trigger="click"
        btnElement={
          <RiMoreFill className='h-4 w-4' />
        }
        btnClassName='btn btn-secondary btn-medium w-8 p-0'
        className={'!z-20 h-fit !w-[155px]'}
        popupClassName='!w-full !overflow-visible'
        manualClose
      />
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
