'use client'
import type { FC } from 'react'
import type { AnnotationItem, HitHistoryItem } from '../type'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { MessageCheckRemove } from '@/app/components/base/icons/src/vender/line/communication'
import Pagination from '@/app/components/base/pagination'
import TabSlider from '@/app/components/base/tab-slider-plain'
import { APP_PAGE_LIMIT } from '@/config'
import useTimestamp from '@/hooks/use-timestamp'
import { fetchHitHistoryList } from '@/service/annotation'
import EditItem, { EditItemType } from '../edit-annotation-modal/edit-item'
import HitHistoryNoData from './hit-history-no-data'

type Props = {
  appId: string
  isShow: boolean
  onHide: () => void
  item: AnnotationItem
  onSave: (editedQuery: string, editedAnswer: string) => Promise<void>
  onRemove: () => void
}

enum TabType {
  annotation = 'annotation',
  hitHistory = 'hitHistory',
}

const ViewAnnotationModal: FC<Props> = ({
  appId,
  isShow,
  onHide,
  item,
  onSave,
  onRemove,
}) => {
  const { id, question, answer, created_at: createdAt } = item
  const [newQuestion, setNewQuery] = useState(question)
  const [newAnswer, setNewAnswer] = useState(answer)
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const [currPage, setCurrPage] = React.useState<number>(0)
  const [total, setTotal] = useState(0)
  const [hitHistoryList, setHitHistoryList] = useState<HitHistoryItem[]>([])

  // Update local state when item prop changes (e.g., when modal is reopened with updated data)
  useEffect(() => {
    setNewQuery(question)
    setNewAnswer(answer)
    setCurrPage(0)
    setTotal(0)
    setHitHistoryList([])
  }, [question, answer, id])

  const fetchHitHistory = async (page = 1) => {
    try {
      const { data, total }: any = await fetchHitHistoryList(appId, id, {
        page,
        limit: 10,
      })
      setHitHistoryList(data as HitHistoryItem[])
      setTotal(total)
    }
    catch {
    }
  }

  useEffect(() => {
    fetchHitHistory(currPage + 1)
  }, [currPage])

  // Fetch hit history when item changes
  useEffect(() => {
    if (isShow && id)
      fetchHitHistory(1)
  }, [id, isShow])

  const tabs = [
    { value: TabType.annotation, text: t('viewModal.annotatedResponse', { ns: 'appAnnotation' }) },
    {
      value: TabType.hitHistory,
      text: (
        hitHistoryList.length > 0
          ? (
              <div className="flex items-center space-x-1">
                <div>{t('viewModal.hitHistory', { ns: 'appAnnotation' })}</div>
                <Badge
                  text={`${total} ${t(`viewModal.hit${hitHistoryList.length > 1 ? 's' : ''}`, { ns: 'appAnnotation' })}`}
                />
              </div>
            )
          : t('viewModal.hitHistory', { ns: 'appAnnotation' })
      ),
    },
  ]
  const [activeTab, setActiveTab] = useState(TabType.annotation)
  const handleSave = async (type: EditItemType, editedContent: string) => {
    try {
      if (type === EditItemType.Query) {
        await onSave(editedContent, newAnswer)
        setNewQuery(editedContent)
      }
      else {
        await onSave(newQuestion, editedContent)
        setNewAnswer(editedContent)
      }
    }
    catch (error) {
      // If save fails, don't update local state
      console.error('Failed to save annotation:', error)
    }
  }
  const [showModal, setShowModal] = useState(false)

  const annotationTab = (
    <>
      <EditItem
        type={EditItemType.Query}
        content={question}
        onSave={editedContent => handleSave(EditItemType.Query, editedContent)}
      />
      <EditItem
        type={EditItemType.Answer}
        content={answer}
        onSave={editedContent => handleSave(EditItemType.Answer, editedContent)}
      />
    </>
  )

  const hitHistoryTab = total === 0
    ? (<HitHistoryNoData />)
    : (
        <div>
          <table className={cn('w-full min-w-[440px] border-collapse border-0')}>
            <thead className="system-xs-medium-uppercase text-text-tertiary">
              <tr>
                <td className="w-5 rounded-l-lg bg-background-section-burn pr-1 pl-2 whitespace-nowrap">{t('hitHistoryTable.query', { ns: 'appAnnotation' })}</td>
                <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('hitHistoryTable.match', { ns: 'appAnnotation' })}</td>
                <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('hitHistoryTable.response', { ns: 'appAnnotation' })}</td>
                <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('hitHistoryTable.source', { ns: 'appAnnotation' })}</td>
                <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('hitHistoryTable.score', { ns: 'appAnnotation' })}</td>
                <td className="w-[160px] rounded-r-lg bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('hitHistoryTable.time', { ns: 'appAnnotation' })}</td>
              </tr>
            </thead>
            <tbody className="system-sm-regular text-text-secondary">
              {hitHistoryList.map(item => (
                <tr
                  key={item.id}
                  className="cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover"
                >
                  <td
                    className="max-w-[250px] overflow-hidden p-3 pr-2 text-ellipsis whitespace-nowrap"
                    title={item.question}
                  >
                    {item.question}
                  </td>
                  <td
                    className="max-w-[250px] overflow-hidden p-3 pr-2 text-ellipsis whitespace-nowrap"
                    title={item.match}
                  >
                    {item.match}
                  </td>
                  <td
                    className="max-w-[250px] overflow-hidden p-3 pr-2 text-ellipsis whitespace-nowrap"
                    title={item.response}
                  >
                    {item.response}
                  </td>
                  <td className="p-3 pr-2">{item.source}</td>
                  <td className="p-3 pr-2">{item.score ? item.score.toFixed(2) : '-'}</td>
                  <td className="p-3 pr-2">{formatTime(item.created_at, t('dateTimeFormat', { ns: 'appLog' }) as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(total && total > APP_PAGE_LIMIT)
            ? (
                <Pagination
                  className="px-0"
                  current={currPage}
                  onChange={setCurrPage}
                  total={total}
                />
              )
            : null}
        </div>

      )
  if (!isShow)
    return null

  return (
    <div>
      <Drawer
        open
        modal
        disablePointerDismissal
        swipeDirection="right"
        onOpenChange={(open) => {
          if (!open)
            onHide()
        }}
      >
        <DrawerPortal>
          <DrawerBackdrop />
          <DrawerViewport>
            <DrawerPopup className="data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-3 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-200 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)] data-[swipe-direction=right]:rounded-xl data-[swipe-direction=right]:border-r-[0.5px] data-[swipe-direction=right]:border-divider-subtle">
              <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                <div className="shrink-0 border-b border-divider-subtle py-4">
                  <div className="flex h-6 items-center justify-between pr-5 pl-6">
                    <DrawerTitle render={<div />} className="min-w-0">
                      <TabSlider
                        className="relative top-[9px] shrink-0"
                        value={activeTab}
                        onChange={v => setActiveTab(v as TabType)}
                        options={tabs}
                        noBorderBottom
                        itemClassName="pb-3.5!"
                      />
                    </DrawerTitle>
                    <DrawerCloseButton
                      aria-label={t('operation.close', { ns: 'common' })}
                      className="h-6 w-6 rounded-md"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-6 p-6 pb-4">
                    {activeTab === TabType.annotation ? annotationTab : hitHistoryTab}
                  </div>
                  <AlertDialog open={showModal} onOpenChange={open => !open && setShowModal(false)}>
                    <AlertDialogContent>
                      <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                        <AlertDialogTitle
                          title={t('feature.annotation.removeConfirm', { ns: 'appDebug' })}
                          className="w-full truncate title-2xl-semi-bold text-text-primary"
                        >
                          {t('feature.annotation.removeConfirm', { ns: 'appDebug' })}
                        </AlertDialogTitle>
                      </div>
                      <AlertDialogActions>
                        <AlertDialogCancelButton>
                          {t('operation.cancel', { ns: 'common' })}
                        </AlertDialogCancelButton>
                        <AlertDialogConfirmButton
                          tone="destructive"
                          onClick={async () => {
                            await onRemove()
                            setShowModal(false)
                            onHide()
                          }}
                        >
                          {t('operation.confirm', { ns: 'common' })}
                        </AlertDialogConfirmButton>
                      </AlertDialogActions>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                {id && (
                  <div className="flex h-16 shrink-0 items-center justify-between rounded-br-xl rounded-bl-xl border-t border-divider-subtle bg-background-section-burn px-4 system-sm-medium text-text-tertiary">
                    <div
                      className="flex cursor-pointer items-center space-x-2 pl-3"
                      onClick={() => setShowModal(true)}
                    >
                      <MessageCheckRemove />
                      <div>{t('editModal.removeThisCache', { ns: 'appAnnotation' })}</div>
                    </div>
                    <div>
                      {t('editModal.createdAt', { ns: 'appAnnotation' })}
&nbsp;
                      {formatTime(createdAt, t('dateTimeFormat', { ns: 'appLog' }) as string)}
                    </div>
                  </div>
                )}
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    </div>

  )
}
export default React.memo(ViewAnnotationModal)
