'use client'
import type { FC } from 'react'
import { RiDeleteBinLine, RiEditFill, RiEditLine } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Robot, User } from '@/app/components/base/icons/src/public/avatar'
import Textarea from '@/app/components/base/textarea'
import { cn } from '@/utils/classnames'

export enum EditItemType {
  Query = 'query',
  Answer = 'answer',
}
type Props = {
  type: EditItemType
  content: string
  readonly?: boolean
  onSave: (content: string) => Promise<void>
}

export const EditTitle: FC<{ className?: string, title: string }> = ({ className, title }) => (
  <div className={cn(className, 'system-xs-medium flex h-[18px] items-center text-text-tertiary')}>
    <RiEditFill className="mr-1 h-3.5 w-3.5" />
    <div>{title}</div>
    <div
      className="ml-2 h-px grow"
      style={{
        background: 'linear-gradient(90deg, rgba(0, 0, 0, 0.05) -1.65%, rgba(0, 0, 0, 0.00) 100%)',
      }}
    >
    </div>
  </div>
)
const EditItem: FC<Props> = ({
  type,
  readonly,
  content,
  onSave,
}) => {
  const { t } = useTranslation()
  const [newContent, setNewContent] = useState('')
  const showNewContent = newContent && newContent !== content
  const avatar = type === EditItemType.Query ? <User className="h-6 w-6" /> : <Robot className="h-6 w-6" />
  const name = type === EditItemType.Query ? t('editModal.queryName', { ns: 'appAnnotation' }) : t('editModal.answerName', { ns: 'appAnnotation' })
  const editTitle = type === EditItemType.Query ? t('editModal.yourQuery', { ns: 'appAnnotation' }) : t('editModal.yourAnswer', { ns: 'appAnnotation' })
  const placeholder = type === EditItemType.Query ? t('editModal.queryPlaceholder', { ns: 'appAnnotation' }) : t('editModal.answerPlaceholder', { ns: 'appAnnotation' })
  const [isEdit, setIsEdit] = useState(false)

  // Reset newContent when content prop changes
  useEffect(() => {
    setNewContent('')
  }, [content])

  const handleSave = async () => {
    try {
      await onSave(newContent)
      setIsEdit(false)
    }
    catch {
      // Keep edit mode open when save fails
      // Error notification is handled by the parent component
    }
  }

  const handleCancel = () => {
    setNewContent('')
    setIsEdit(false)
  }

  return (
    <div className="flex" onClick={e => e.stopPropagation()}>
      <div className="mr-3 shrink-0">
        {avatar}
      </div>
      <div className="grow">
        <div className="system-xs-semibold mb-1 text-text-primary">{name}</div>
        <div className="system-sm-regular text-text-primary">{content}</div>
        {!isEdit
          ? (
              <div>
                {showNewContent && (
                  <div className="mt-3">
                    <EditTitle title={editTitle} />
                    <div className="system-sm-regular mt-1 text-text-primary">{newContent}</div>
                  </div>
                )}
                <div className="mt-2 flex items-center">
                  {!readonly && (
                    <div
                      className="system-xs-medium flex cursor-pointer items-center space-x-1 text-text-accent"
                      onClick={() => {
                        setIsEdit(true)
                      }}
                    >
                      <RiEditLine className="mr-1 h-3.5 w-3.5" />
                      <div>{t('operation.edit', { ns: 'common' })}</div>
                    </div>
                  )}

                  {showNewContent && (
                    <div className="system-xs-medium ml-2 flex items-center text-text-tertiary">
                      <div className="mr-2">·</div>
                      <div
                        className="flex cursor-pointer items-center space-x-1"
                        onClick={async () => {
                          try {
                            await onSave(content)
                            // Only update UI state after successful delete
                            setNewContent(content)
                          }
                          catch {
                          // Delete action failed - error is already handled by parent
                          // UI state remains unchanged, user can retry
                          }
                        }}
                      >
                        <div className="h-3.5 w-3.5">
                          <RiDeleteBinLine className="h-3.5 w-3.5" />
                        </div>
                        <div>{t('operation.delete', { ns: 'common' })}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          : (
              <div className="mt-3">
                <EditTitle title={editTitle} />
                <Textarea
                  value={newContent}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewContent(e.target.value)}
                  placeholder={placeholder}
                  autoFocus
                />
                <div className="mt-2 flex space-x-2">
                  <Button size="small" variant="primary" onClick={handleSave}>{t('operation.save', { ns: 'common' })}</Button>
                  <Button size="small" onClick={handleCancel}>{t('operation.cancel', { ns: 'common' })}</Button>
                </div>
              </div>
            )}
      </div>
    </div>
  )
}
export default React.memo(EditItem)
