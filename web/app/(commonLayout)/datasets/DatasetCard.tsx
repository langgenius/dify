'use client'

import { useContext } from 'use-context-selector'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiMoreFill } from '@remixicon/react'
import cn from '@/utils/classnames'
import Confirm from '@/app/components/base/confirm'
import { ToastContext } from '@/app/components/base/toast'
import { checkIsUsedInApp, deleteDataset } from '@/service/datasets'
import type { DataSet } from '@/models/datasets'
import Tooltip from '@/app/components/base/tooltip'
import { Folder } from '@/app/components/base/icons/src/vender/solid/files'
import type { HtmlContentProps } from '@/app/components/base/popover'
import CustomPopover from '@/app/components/base/popover'
import Divider from '@/app/components/base/divider'
import RenameDatasetModal from '@/app/components/datasets/rename-modal'
import type { Tag } from '@/app/components/base/tag-management/constant'
import TagSelector from '@/app/components/base/tag-management/selector'
import CornerLabel from '@/app/components/base/corner-label'
import { useAppContext } from '@/context/app-context'

export type DatasetCardProps = {
  dataset: DataSet
  onSuccess?: () => void
}

const DatasetCard = ({
  dataset,
  onSuccess,
}: DatasetCardProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { push } = useRouter()
  const EXTERNAL_PROVIDER = 'external' as const

  const { isCurrentWorkspaceDatasetOperator } = useAppContext()
  const [tags, setTags] = useState<Tag[]>(dataset.tags)

  const [showRenameModal, setShowRenameModal] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [confirmMessage, setConfirmMessage] = useState<string>('')
  const isExternalProvider = (provider: string): boolean => provider === EXTERNAL_PROVIDER
  const detectIsUsedByApp = useCallback(async () => {
    try {
      const { is_using: isUsedByApp } = await checkIsUsedInApp(dataset.id)
      setConfirmMessage(isUsedByApp ? t('dataset.datasetUsedByApp')! : t('dataset.deleteDatasetConfirmContent')!)
    }
    catch (e: any) {
      const res = await e.json()
      notify({ type: 'error', message: res?.message || 'Unknown error' })
    }

    setShowConfirmDelete(true)
  }, [dataset.id, notify, t])
  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteDataset(dataset.id)
      notify({ type: 'success', message: t('dataset.datasetDeleted') })
      if (onSuccess)
        onSuccess()
    }
    catch (e: any) {
    }
    setShowConfirmDelete(false)
  }, [dataset.id, notify, onSuccess, t])

  const Operations = (props: HtmlContentProps & { showDelete: boolean }) => {
    const onMouseLeave = async () => {
      props.onClose?.()
    }
    const onClickRename = async (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      props.onClick?.()
      e.preventDefault()
      setShowRenameModal(true)
    }
    const onClickDelete = async (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      props.onClick?.()
      e.preventDefault()
      detectIsUsedByApp()
    }
    return (
      <div className="relative w-full py-1" onMouseLeave={onMouseLeave}>
        <div className='mx-1 flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 py-[6px] hover:bg-gray-100' onClick={onClickRename}>
          <span className='text-sm text-gray-700'>{t('common.operation.settings')}</span>
        </div>
        {props.showDelete && (
          <>
            <Divider className="!my-1" />
            <div
              className='group mx-1 flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 py-[6px] hover:bg-red-50'
              onClick={onClickDelete}
            >
              <span className={cn('text-sm text-gray-700', 'group-hover:text-red-500')}>
                {t('common.operation.delete')}
              </span>
            </div>
          </>
        )}
      </div>
    )
  }

  useEffect(() => {
    setTags(dataset.tags)
  }, [dataset])

  return (
    <>
      <div
        className='bg-components-card-bg border-components-card-border group relative col-span-1 flex min-h-[160px] cursor-pointer flex-col rounded-xl border-[0.5px] border-solid shadow-sm transition-all duration-200 ease-in-out hover:shadow-lg'
        data-disable-nprogress={true}
        onClick={(e) => {
          e.preventDefault()
          isExternalProvider(dataset.provider)
            ? push(`/datasets/${dataset.id}/hitTesting`)
            : push(`/datasets/${dataset.id}/documents`)
        }}
      >
        {isExternalProvider(dataset.provider) && <CornerLabel label='External' className='absolute right-0' labelClassName='rounded-tr-xl' />}
        <div className='flex h-[66px] shrink-0 grow-0 items-center gap-3 px-[14px] pb-3 pt-[14px]'>
          <div className={cn(
            'flex shrink-0 items-center justify-center rounded-md border-[0.5px] border-[#E0EAFF] bg-[#F5F8FF] p-2.5',
            !dataset.embedding_available && 'opacity-50 hover:opacity-100',
          )}>
            <Folder className='h-5 w-5 text-[#444CE7]' />
          </div>
          <div className='w-0 grow py-[1px]'>
            <div className='text-text-secondary flex items-center text-sm font-semibold leading-5'>
              <div className={cn('truncate', !dataset.embedding_available && 'text-text-tertiary opacity-50 hover:opacity-100')} title={dataset.name}>{dataset.name}</div>
              {!dataset.embedding_available && (
                <Tooltip
                  popupContent={t('dataset.unavailableTip')}
                >
                  <span className='ml-1 inline-flex w-max shrink-0 rounded-md border border-gray-200 px-1 text-xs font-normal leading-[18px] text-gray-500'>{t('dataset.unavailable')}</span>
                </Tooltip>
              )}
            </div>
            <div className='text-text-tertiary mt-[1px] flex items-center text-xs leading-[18px]'>
              <div
                className={cn('truncate', (!dataset.embedding_available || !dataset.document_count) && 'opacity-50')}
                title={dataset.provider === 'external' ? `${dataset.app_count}${t('dataset.appCount')}` : `${dataset.document_count}${t('dataset.documentCount')} · ${Math.round(dataset.word_count / 1000)}${t('dataset.wordCount')} · ${dataset.app_count}${t('dataset.appCount')}`}
              >
                {dataset.provider === 'external'
                  ? <>
                    <span>{dataset.app_count}{t('dataset.appCount')}</span>
                  </>
                  : <>
                    <span>{dataset.document_count}{t('dataset.documentCount')}</span>
                    <span className='mx-0.5 w-1 shrink-0 text-gray-400'>·</span>
                    <span>{Math.round(dataset.word_count / 1000)}{t('dataset.wordCount')}</span>
                    <span className='mx-0.5 w-1 shrink-0 text-gray-400'>·</span>
                    <span>{dataset.app_count}{t('dataset.appCount')}</span>
                  </>
                }
              </div>
            </div>
          </div>
        </div>
        <div
          className={cn(
            'text-text-tertiary mb-2 max-h-[72px] grow px-[14px] text-xs leading-normal group-hover:line-clamp-2 group-hover:max-h-[36px]',
            tags.length ? 'line-clamp-2' : 'line-clamp-4',
            !dataset.embedding_available && 'opacity-50 hover:opacity-100',
          )}
          title={dataset.description}>
          {dataset.description}
        </div>
        <div className={cn(
          'mt-1 h-[42px] shrink-0 items-center pb-[6px] pl-[14px] pr-[6px] pt-1',
          tags.length ? 'flex' : '!hidden group-hover:!flex',
        )}>
          <div className={cn('flex w-0 grow items-center gap-1', !dataset.embedding_available && 'opacity-50 hover:opacity-100')} onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}>
            <div className={cn(
              'mr-[41px] w-full grow group-hover:!mr-0 group-hover:!block',
              tags.length ? '!block' : '!hidden',
            )}>
              <TagSelector
                position='bl'
                type='knowledge'
                targetID={dataset.id}
                value={tags.map(tag => tag.id)}
                selectedTags={tags}
                onCacheUpdate={setTags}
                onChange={onSuccess}
              />
            </div>
          </div>
          <div className='mx-1 !hidden h-[14px] w-[1px] shrink-0 bg-gray-200 group-hover:!flex' />
          <div className='!hidden shrink-0 group-hover:!flex'>
            <CustomPopover
              htmlContent={<Operations showDelete={!isCurrentWorkspaceDatasetOperator} />}
              position="br"
              trigger="click"
              btnElement={
                <div
                  className='flex h-8 w-8 cursor-pointer items-center justify-center rounded-md'
                >
                  <RiMoreFill className='h-4 w-4 text-gray-700' />
                </div>
              }
              btnClassName={open =>
                cn(
                  open ? '!bg-black/5 !shadow-none' : '!bg-transparent',
                  'h-8 w-8 rounded-md border-none !p-2 hover:!bg-black/5',
                )
              }
              className={'!z-20 h-fit !w-[128px]'}
            />
          </div>
        </div>
      </div>
      {showRenameModal && (
        <RenameDatasetModal
          show={showRenameModal}
          dataset={dataset}
          onClose={() => setShowRenameModal(false)}
          onSuccess={onSuccess}
        />
      )}
      {showConfirmDelete && (
        <Confirm
          title={t('dataset.deleteDatasetConfirmTitle')}
          content={confirmMessage}
          isShow={showConfirmDelete}
          onConfirm={onConfirmDelete}
          onCancel={() => setShowConfirmDelete(false)}
        />
      )}
    </>
  )
}

export default DatasetCard
