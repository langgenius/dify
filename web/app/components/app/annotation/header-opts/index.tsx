'use client'
import type { FC } from 'react'
import React, { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiMoreFill,
} from '@remixicon/react'
import { useContext } from 'use-context-selector'
import {
  useCSVDownloader,
} from 'react-papaparse'
import { Menu, Transition } from '@headlessui/react'
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
import { LanguagesSupported } from '@/i18n/language'

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
    a.href = URL.createObjectURL(file)
    a.download = `annotations-${locale}.jsonl`
    a.click()
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

  const Operations = () => {
    return (
      <div className="w-full py-1">
        <button className='h-9 py-2 px-3 mx-1 flex items-center space-x-2 hover:bg-components-panel-on-panel-item-bg-hover rounded-lg cursor-pointer disabled:opacity-50 w-[calc(100%_-_8px)]' onClick={() => {
          setShowBulkImportModal(true)
        }}>
          <FilePlus02 className='w-4 h-4 text-text-tertiary' />
          <span className='grow text-text-secondary system-sm-regular text-left'>{t('appAnnotation.table.header.bulkImport')}</span>
        </button>
        <Menu as="div" className="relative w-full h-full">
          <Menu.Button className='h-9 py-2 px-3 mx-1 flex items-center space-x-2 hover:bg-components-panel-on-panel-item-bg-hover rounded-lg cursor-pointer disabled:opacity-50 w-[calc(100%_-_8px)]'>
            <FileDownload02 className='w-4 h-4 text-text-tertiary' />
            <span className='grow text-text-secondary system-sm-regular text-left'>{t('appAnnotation.table.header.bulkExport')}</span>
            <ChevronRight className='shrink-0 w-[14px] h-[14px] text-text-tertiary' />
          </Menu.Button>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <Menu.Items
              className={cn(
                'absolute top-[1px] left-1 -translate-x-full py-1 min-w-[100px] z-10 bg-components-panel-bg border-[0.5px] border-components-panel-on-panel-item-bg origin-top-right rounded-xl shadow-xs',
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
                <button disabled={annotationUnavailable} className='h-9 py-2 px-3 mx-1 flex items-center space-x-2 hover:bg-components-panel-on-panel-item-bg-hover rounded-lg cursor-pointer disabled:opacity-50 w-[calc(100%_-_8px)]'>
                  <span className='grow text-text-secondary system-sm-regular text-left'>CSV</span>
                </button>
              </CSVDownloader>
              <button disabled={annotationUnavailable} className={cn('h-9 py-2 px-3 mx-1 flex items-center space-x-2 hover:bg-components-panel-on-panel-item-bg-hover rounded-lg cursor-pointer disabled:opacity-50 w-[calc(100%_-_8px)]', '!border-0')} onClick={JSONLOutput}>
                <span className='grow text-text-secondary system-sm-regular text-left'>JSONL</span>
              </button>
            </Menu.Items>
          </Transition>
        </Menu>
      </div>
    )
  }

  const [showAddModal, setShowAddModal] = React.useState(false)

  return (
    <div className='flex space-x-2'>
      <Button variant='primary' onClick={() => setShowAddModal(true)}>
        <RiAddLine className='w-4 h-4 mr-0.5' />
        <div>{t('appAnnotation.table.header.addAnnotation')}</div>
      </Button>
      <CustomPopover
        htmlContent={<Operations />}
        position="br"
        trigger="click"
        btnElement={
          <Button variant='secondary' className='w-8 p-0'>
            <RiMoreFill className='w-4 h-4' />
          </Button>
        }
        btnClassName='p-0 border-0'
        className={'!w-[155px] h-fit !z-20'}
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
    </div>
  )
}
export default React.memo(HeaderOptions)
