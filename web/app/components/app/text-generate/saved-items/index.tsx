'use client'
import type { FC } from 'react'
import type { SavedMessage } from '@/models/debug'
import {
  RiClipboardLine,
  RiDeleteBinLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { Markdown } from '@/app/components/base/markdown'
import NewAudioButton from '@/app/components/base/new-audio-button'
import Toast from '@/app/components/base/toast'
import { cn } from '@/utils/classnames'
import NoData from './no-data'

export type ISavedItemsProps = {
  className?: string
  isShowTextToSpeech?: boolean
  list: SavedMessage[]
  onRemove: (id: string) => void
  onStartCreateContent: () => void
}

const SavedItems: FC<ISavedItemsProps> = ({
  className,
  isShowTextToSpeech,
  list,
  onRemove,
  onStartCreateContent,
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn('space-y-4', className)}>
      {list.length === 0
        ? (
            <NoData onStartCreateContent={onStartCreateContent} />
          )
        : (
            <>
              {list.map(({ id, answer }) => (
                <div key={id} className="relative">
                  <div className={cn(
                    'rounded-2xl bg-background-section-burn p-4',
                  )}
                  >
                    <Markdown content={answer} />
                  </div>
                  <div className="system-xs-regular mt-1 h-4 px-4 text-text-quaternary">
                    <span>
                      {answer.length}
                      {' '}
                      {t('unit.char', { ns: 'common' })}
                    </span>
                  </div>
                  <div className="absolute bottom-1 right-2">
                    <div className="ml-1 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md backdrop-blur-sm">
                      {isShowTextToSpeech && <NewAudioButton value={answer} />}
                      <ActionButton onClick={() => {
                        copy(answer)
                        Toast.notify({ type: 'success', message: t('actionMsg.copySuccessfully', { ns: 'common' }) })
                      }}
                      >
                        <RiClipboardLine className="h-4 w-4" />
                      </ActionButton>
                      <ActionButton onClick={() => {
                        onRemove(id)
                      }}
                      >
                        <RiDeleteBinLine className="h-4 w-4" />
                      </ActionButton>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

    </div>
  )
}
export default React.memo(SavedItems)
