'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Button from '../../../base/button'
import { Plus } from '../../../base/icons/src/vender/line/general'
import AddAnnotationModal from '../add-annotation-modal'
import type { AnnotationItemBasic } from '../type'
import s from './style.module.css'
import CustomPopover from '@/app/components/base/popover'
// import Divider from '@/app/components/base/divider'
import { FileDownload02 } from '@/app/components/base/icons/src/vender/line/files'

type Props = {
  onAdd: (payload: AnnotationItemBasic) => void
  onExport: () => void
  // onClearAll: () => void
}

const HeaderOptions: FC<Props> = ({
  onAdd,
  onExport,
  // onClearAll,
}) => {
  const { t } = useTranslation()

  const Operations = () => {
    const handleExport = () => {
      onExport()
    }
    // const onClickDelete = async (e: React.MouseEvent<HTMLDivElement>) => {
    //   e.stopPropagation()
    //   props.onClick?.()
    //   e.preventDefault()
    //   // setShowConfirmDelete(true)
    // }
    return (
      <div className="w-full py-1">
        {/* <button className={s.actionItem} onClick={onClickSettings}>
          <FilePlus02 className={s.actionItemIcon} />
          <span className={s.actionName}>{t('appAnnotation.table.header.bulkImport')}</span>
        </button> */}

        <button className={s.actionItem} onClick={handleExport}>
          <FileDownload02 className={s.actionItemIcon} />
          <span className={s.actionName}>{t('appAnnotation.table.header.bulkExport')}</span>
        </button>

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

  const [showAddModal, setShowAddModal] = React.useState(true)

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
        className={'!w-[130px] h-fit !z-20'}
        manualClose
      />
      {showAddModal && (
        <AddAnnotationModal
          isShow={showAddModal}
          onHide={() => setShowAddModal(false)}
          onAdd={onAdd}
        />
      )}
    </div>
  )
}
export default React.memo(HeaderOptions)
