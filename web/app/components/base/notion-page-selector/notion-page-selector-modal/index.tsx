import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { XMarkIcon } from '@heroicons/react/24/outline'
import NotionPageSelector from '../base'
import s from './index.module.css'
import type { NotionPage } from '@/models/common'
import cn from '@/utils/classnames'
import Modal from '@/app/components/base/modal'
import { noop } from 'lodash-es'
import { useGetDefaultDataSourceListAuth } from '@/service/use-datasource'
import NotionConnector from '../../notion-connector'
import { useModalContextSelector } from '@/context/modal-context'

type NotionPageSelectorModalProps = {
  isShow: boolean
  onClose: () => void
  onSave: (selectedPages: NotionPage[]) => void
  datasetId: string
}
const NotionPageSelectorModal = ({
  isShow,
  onClose,
  onSave,
  datasetId,
}: NotionPageSelectorModalProps) => {
  const { t } = useTranslation()
  const setShowAccountSettingModal = useModalContextSelector(state => state.setShowAccountSettingModal)
  const [selectedPages, setSelectedPages] = useState<NotionPage[]>([])

  const { data: dataSourceList } = useGetDefaultDataSourceListAuth()

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleSelectPage = useCallback((newSelectedPages: NotionPage[]) => {
    setSelectedPages(newSelectedPages)
  }, [])

  const handleSave = useCallback(() => {
    onSave(selectedPages)
  }, [onSave])

  const handleOpenSetting = useCallback(() => {
    setShowAccountSettingModal({ payload: 'data-source' })
  }, [setShowAccountSettingModal])

  const authedDataSourceList = dataSourceList?.result || []

  const isNotionAuthed = useMemo(() => {
    if (!authedDataSourceList) return false
    const notionSource = authedDataSourceList.find(item => item.provider === 'notion_datasource')
    if (!notionSource) return false
    return notionSource.credentials_list.length > 0
  }, [authedDataSourceList])

  const notionCredentialList = useMemo(() => {
    return authedDataSourceList.find(item => item.provider === 'notion_datasource')?.credentials_list || []
  }, [authedDataSourceList])

  return (
    <Modal
      className={s.modal}
      isShow={isShow}
      onClose={noop}
    >
      <div className='mb-6 flex h-8 items-center justify-between'>
        <div className='text-xl font-semibold text-text-primary'>{t('common.dataSource.notion.selector.addPages')}</div>
        <div
          className='-mr-2 flex h-8 w-8 cursor-pointer items-center justify-center'
          onClick={handleClose}>
          <XMarkIcon className='h-4 w-4' />
        </div>
      </div>
      {!isNotionAuthed && <NotionConnector onSetting={handleOpenSetting} />}
      {isNotionAuthed && (
        <NotionPageSelector
          credentialList={notionCredentialList}
          onSelect={handleSelectPage}
          canPreview={false}
          datasetId={datasetId}
        />
      )}
      <div className='mt-8 flex justify-end'>
        <div className={s.operate} onClick={handleClose}>{t('common.operation.cancel')}</div>
        <div className={cn(s.operate, s['operate-save'])} onClick={handleSave}>{t('common.operation.save')}</div>
      </div>
    </Modal>
  )
}

export default NotionPageSelectorModal
