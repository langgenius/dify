'use client'
import type { FC } from 'react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import { ClipboardDocumentIcon, HandThumbDownIcon, HandThumbUpIcon } from '@heroicons/react/24/outline'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { toast } from '@/app/components/base/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'

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
    <div className="flex w-full items-center justify-between">
      <div className="text-2xl font-normal leading-4 text-gray-800">{t('generation.resultTitle', { ns: 'share' })}</div>
      <div className="flex items-center space-x-2">
        <Button
          className="h-7 p-[2px] pr-2"
          onClick={() => {
            copy(result)
            toast.success(t('actionMsg.copySuccessfully', { ns: 'common' }))
          }}
        >
          <>
            <ClipboardDocumentIcon className="mr-1 h-3 w-4 text-gray-500" />
            <span className="text-xs leading-3 text-gray-500">{t('generation.copy', { ns: 'share' })}</span>
          </>
        </Button>

        {showFeedback && feedback.rating && feedback.rating === 'like' && (
          <Tooltip>
            <TooltipTrigger
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-primary-200 bg-primary-100 !text-primary-600 hover:border-primary-300 hover:bg-primary-200"
              onClick={() => {
                onFeedback({
                  rating: null,
                })
              }}
            >
              <HandThumbUpIcon width={16} height={16} />
            </TooltipTrigger>
            <TooltipContent>{t('generation.feedback.undoLike', { ns: 'share' })}</TooltipContent>
          </Tooltip>
        )}

        {showFeedback && feedback.rating && feedback.rating === 'dislike' && (
          <Tooltip>
            <TooltipTrigger
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-red-200 bg-red-100 !text-red-600 hover:border-red-300 hover:bg-red-200"
              onClick={() => {
                onFeedback({
                  rating: null,
                })
              }}
            >
              <HandThumbDownIcon width={16} height={16} />
            </TooltipTrigger>
            <TooltipContent>{t('generation.feedback.undoDislike', { ns: 'share' })}</TooltipContent>
          </Tooltip>
        )}

        {showFeedback && !feedback.rating && (
          <div className="flex space-x-1 rounded-lg border border-gray-200 p-[1px]">
            <Tooltip>
              <TooltipTrigger
                delay={0}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-gray-100"
                onClick={() => {
                  onFeedback({
                    rating: 'like',
                  })
                }}
              >
                <HandThumbUpIcon width={16} height={16} />
              </TooltipTrigger>
              <TooltipContent>{t('generation.feedback.like', { ns: 'share' })}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                delay={0}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-gray-100"
                onClick={() => {
                  onFeedback({
                    rating: 'dislike',
                  })
                }}
              >
                <HandThumbDownIcon width={16} height={16} />
              </TooltipTrigger>
              <TooltipContent>{t('generation.feedback.dislike', { ns: 'share' })}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

    </div>
  )
}

export default React.memo(Header)
