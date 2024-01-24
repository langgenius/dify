'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { useContext } from 'use-context-selector'
import {
  useCSVDownloader,
} from 'react-papaparse'
import Button from '../../../base/button'
import { Plus } from '../../../base/icons/src/vender/line/general'
import AddAnnotationModal from '../add-annotation-modal'
import type { AnnotationItemBasic } from '../type'
import BatchAddModal from '../batch-add-annotation-modal'
import s from './style.module.css'
import CustomPopover from '@/app/components/base/popover'
import { FileDownload02, FilePlus02 } from '@/app/components/base/icons/src/vender/line/files'
import I18n from '@/context/i18n'
import { fetchExportAnnotationList } from '@/service/annotation'
import { LanguagesSupportedUnderscore, getModelRuntimeSupported } from '@/utils/language'
const CSV_HEADER_QA_EN = ['Question', 'Answer']
const CSV_HEADER_QA_CN = ['问题', '答案']

type Props = {
  appId: string
  onAdd: (payload: AnnotationItemBasic) => void
  onAdded: () => void
  controlUpdateList: number
  // onClearAll: () => void
}

const HeaderOptions: FC<Props> = ({
  appId,
  onAdd,
  onAdded,
  // onClearAll,
  controlUpdateList,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getModelRuntimeSupported(locale)
  const { CSVDownloader, Type } = useCSVDownloader()
  const [list, setList] = useState<AnnotationItemBasic[]>([])
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
        <button className={s.actionItem} onClick={() => {
          setShowBulkImportModal(true)
        }}>
          <FilePlus02 className={s.actionItemIcon} />
          <span className={s.actionName}>{t('appAnnotation.table.header.bulkImport')}</span>
        </button>

        <CSVDownloader
          type={Type.Link}
          filename={`annotations-${language}`}
          bom={true}
          data={[
            language !== LanguagesSupportedUnderscore[1] ? CSV_HEADER_QA_EN : CSV_HEADER_QA_CN,
            ...list.map(item => [item.question, item.answer]),
          ]}
        >
          <button className={s.actionItem}>
            <FileDownload02 className={s.actionItemIcon} />
            <span className={s.actionName}>{t('appAnnotation.table.header.bulkExport')}</span>
          </button>
        </CSVDownloader>

        {/* <Divider className="!my-1" />
        <div
          className={cn(s.actionItem, s.deleteActionItem, 'group')}
          onClick={onClickDelete}
        >
          <Trash03 className={cn(s.actionItemIcon, 'group-hover:text-red-500')} />
          <span className={cn(s.actionName, 'group-hover:text-red-500')}>
            {t('appAnnotation.table.header.clearAll')}
          </span>
        </div> */}
      </div>
    )
  }

  const [showAddModal, setShowAddModal] = React.useState(false)

  return (
    <div className='flex space-x-2'>
      <Button type='primary' onClick={() => setShowAddModal(true)} className='flex items-center !h-8 !px-3 !text-[13px] space-x-2'>
        <Plus className='w-4 h-4' />
        <div>{t('appAnnotation.table.header.addAnnotation')}</div>
      </Button>
      <CustomPopover
        htmlContent={<Operations />}
        position="br"
        trigger="click"
        btnElement={<div className={cn(s.actionIcon, s.commonIcon)} />}
        btnClassName={open =>
          cn(
            open ? 'border-gray-300 !bg-gray-100 !shadow-none' : 'border-gray-200',
            s.actionIconWrapper,
          )
        }
        // !w-[208px]
        className={'!w-[135px] h-fit !z-20'}
        popupClassName='!w-full'
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
