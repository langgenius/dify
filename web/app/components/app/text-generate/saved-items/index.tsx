'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import copy from 'copy-to-clipboard'
import NoData from './no-data'
import cn from '@/utils/classnames'
import type { SavedMessage } from '@/models/debug'
import { Markdown } from '@/app/components/base/markdown'
import { SimpleBtn, copyIcon } from '@/app/components/app/text-generate/item'
import Toast from '@/app/components/base/toast'
import AudioBtn from '@/app/components/base/audio-btn'

export type ISavedItemsProps = {
  className?: string
  isShowTextToSpeech?: boolean
  list: SavedMessage[]
  onRemove: (id: string) => void
  onStartCreateContent: () => void
}

const removeIcon = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.25 1.75H8.75M1.75 3.5H12.25M11.0833 3.5L10.6742 9.63625C10.6129 10.5569 10.5822 11.0172 10.3833 11.3663C10.2083 11.6735 9.94422 11.9206 9.62597 12.0748C9.26448 12.25 8.80314 12.25 7.88045 12.25H6.11955C5.19686 12.25 4.73552 12.25 4.37403 12.0748C4.05577 11.9206 3.79172 11.6735 3.61666 11.3663C3.41781 11.0172 3.38713 10.5569 3.32575 9.63625L2.91667 3.5M5.83333 6.125V9.04167M8.16667 6.125V9.04167" stroke="#344054" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const SavedItems: FC<ISavedItemsProps> = ({
  className,
  isShowTextToSpeech,
  list,
  onRemove,
  onStartCreateContent,
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn(className, 'space-y-3')}>
      {list.length === 0
        ? (
          <div className='px-6'>
            <NoData onStartCreateContent={onStartCreateContent} />
          </div>
        )
        : (<>
          {list.map(({ id, answer }) => (
            <div
              key={id}
              className='rounded-xl bg-gray-50  p-4'
              style={{
                boxShadow: '0px 1px 2px rgba(16, 24, 40, 0.05)',
              }}
            >
              <Markdown content={answer} />
              <div className='mt-3 flex items-center justify-between'>
                <div className='flex items-center space-x-2'>
                  <SimpleBtn
                    className='space-x-1'
                    onClick={() => {
                      copy(answer)
                      Toast.notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
                    }}>
                    {copyIcon}
                    <div>{t('common.operation.copy')}</div>
                  </SimpleBtn>

                  <SimpleBtn
                    className='space-x-1'
                    onClick={() => {
                      onRemove(id)
                    }}>
                    {removeIcon}
                    <div>{t('common.operation.remove')}</div>
                  </SimpleBtn>

                  {isShowTextToSpeech && (
                    <>
                      <div className='ml-2 mr-2 h-[14px] w-[1px] bg-gray-200'></div>
                      <AudioBtn
                        value={answer}
                        noCache={false}
                        className={'mr-1'}
                      />
                    </>
                  )}
                </div>
                <div className='text-xs text-gray-500'>{answer?.length} {t('common.unit.char')}</div>
              </div>
            </div>
          ))}
        </>)}

    </div>
  )
}
export default React.memo(SavedItems)
