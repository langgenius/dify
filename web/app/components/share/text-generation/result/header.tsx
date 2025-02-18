'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardDocumentIcon, HandThumbDownIcon, HandThumbUpIcon } from '@heroicons/react/24/outline'
import copy from 'copy-to-clipboard'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'

type IResultHeaderProps = {
  result: string
  showFeedback: boolean
  feedback: FeedbackType
  onFeedback: (feedback: FeedbackType) => void
}

const Header: FC<IResultHeaderProps> = ({
  feedback,
  showFeedback,
  onFeedback,
  result,
}) => {
  const { t } = useTranslation()
  return (
    <div className='flex w-full items-center justify-between '>
      <div className='text-2xl font-normal leading-4 text-gray-800'>{t('share.generation.resultTitle')}</div>
      <div className='flex items-center space-x-2'>
        <Button
          className='h-7 p-[2px] pr-2'
          onClick={() => {
            copy(result)
            Toast.notify({ type: 'success', message: 'copied' })
          }}
        >
          <>
            <ClipboardDocumentIcon className='mr-1 h-3 w-4 text-gray-500' />
            <span className='text-xs leading-3 text-gray-500'>{t('share.generation.copy')}</span>
          </>
        </Button>

        {showFeedback && feedback.rating && feedback.rating === 'like' && (
          <Tooltip
            popupContent="Undo Great Rating"
          >
            <div
              onClick={() => {
                onFeedback({
                  rating: null,
                })
              }}
              className='!text-primary-600 border-primary-200 bg-primary-100 hover:border-primary-300 hover:bg-primary-200 flex h-7  w-7 cursor-pointer items-center justify-center rounded-md border'>
              <HandThumbUpIcon width={16} height={16} />
            </div>
          </Tooltip>
        )}

        {showFeedback && feedback.rating && feedback.rating === 'dislike' && (
          <Tooltip
            popupContent="Undo Undesirable Response"
          >
            <div
              onClick={() => {
                onFeedback({
                  rating: null,
                })
              }}
              className='flex h-7 w-7 cursor-pointer items-center justify-center rounded-md  border border-red-200 bg-red-100 !text-red-600 hover:border-red-300 hover:bg-red-200'>
              <HandThumbDownIcon width={16} height={16} />
            </div>
          </Tooltip>
        )}

        {showFeedback && !feedback.rating && (
          <div className='flex space-x-1 rounded-lg border border-gray-200 p-[1px]'>
            <Tooltip
              popupContent="Great Rating"
              needsDelay={false}
            >
              <div
                onClick={() => {
                  onFeedback({
                    rating: 'like',
                  })
                }}
                className='flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-gray-100'>
                <HandThumbUpIcon width={16} height={16} />
              </div>
            </Tooltip>
            <Tooltip
              popupContent="Undesirable Response"
              needsDelay={false}
            >
              <div
                onClick={() => {
                  onFeedback({
                    rating: 'dislike',
                  })
                }}
                className='flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-gray-100'>
                <HandThumbDownIcon width={16} height={16} />
              </div>
            </Tooltip>
          </div>
        )}
      </div>

    </div>
  )
}

export default React.memo(Header)
