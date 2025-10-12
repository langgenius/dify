import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
} from '@remixicon/react'
import { Memory } from '@/app/components/base/icons/src/vender/line/others'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import Indicator from '@/app/components/header/indicator'
import Operation from './operation'
import MemoryEditModal from './edit-modal'
import type { Memory as MemoryItem } from '@/app/components/base/chat/types'
import cn from '@/utils/classnames'

type Props = {
  isMobile?: boolean
  memory: MemoryItem
  updateMemory: (memory: MemoryItem, content: string) => void
  resetDefault: (memory: MemoryItem) => void
  clearAllUpdateVersion: (memory: MemoryItem) => void
  switchMemoryVersion: (memory: MemoryItem, version: string) => void
}

const MemoryCard: React.FC<Props> = ({
  isMobile,
  memory,
  updateMemory,
  resetDefault,
  clearAllUpdateVersion,
  switchMemoryVersion,
}) => {
  const { t } = useTranslation()
  const [isHovering, setIsHovering] = React.useState(false)
  const [showEditModal, setShowEditModal] = React.useState(false)

  const versionTag = useMemo(() => {
    const res = `${t('share.chat.memory.updateVersion.update')} ${memory.version}`
    if (memory.edited_by_user)
      return `${res} · ${t('share.chat.memory.updateVersion.edited')}`
    return res
  }, [memory.version, t])

  const isLatest = useMemo(() => {
    if (memory.conversation_metadata)
      return memory.conversation_metadata.visible_count === memory.spec.preserved_turns

    return true
  }, [memory])

  const waitMergeCount = useMemo(() => {
    if (memory.conversation_metadata)
      return memory.conversation_metadata.visible_count - memory.spec.preserved_turns

    return 0
  }, [memory])

  const prevVersion = () => {
    if (memory.version > 1)
      switchMemoryVersion(memory, (memory.version - 1).toString())
  }

  const nextVersion = () => {
    switchMemoryVersion(memory, (memory.version + 1).toString())
  }

  return (
    <>
      <div
        className={cn('group mb-1 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-md')}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <div className='relative flex items-end justify-between pb-1 pl-4 pr-2 pt-2'>
          <div className='flex items-center gap-1 pb-1 pt-2'>
            <Memory className='h-4 w-4 shrink-0 text-util-colors-teal-teal-700' />
            <div className='system-sm-semibold truncate text-text-primary'>{memory.spec.name}</div>
            {memory.version > 1 && <Badge text={versionTag} className='!h-4' />}
          </div>
          {isHovering && (
            <div className='hover:bg-components-actionbar-bg-hover absolute bottom-0 right-2 flex items-center gap-0.5 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-md'>
              <ActionButton onClick={prevVersion}><RiArrowUpSLine className='h-4 w-4' /></ActionButton>
              <ActionButton onClick={nextVersion}><RiArrowDownSLine className='h-4 w-4' /></ActionButton>
              <Operation
                memory={memory}
                onEdit={() => {
                  setShowEditModal(true)
                  setIsHovering(false)
                }}
                resetDefault={resetDefault}
                clearAllUpdateVersion={clearAllUpdateVersion}
                switchMemoryVersion={switchMemoryVersion}
              />
            </div>
          )}
        </div>
        <div className='system-xs-regular line-clamp-[12] px-4 pb-2 pt-1 text-text-tertiary'>{memory.value}</div>
        {isLatest && (
          <div className='flex items-center gap-1 rounded-b-xl border-t-[0.5px] border-divider-subtle bg-background-default-subtle px-4 py-3 group-hover:bg-components-panel-on-panel-item-bg-hover'>
            <div className='system-xs-regular text-text-tertiary'>{t('share.chat.memory.latestVersion')}</div>
            <Indicator color='green' />
          </div>
        )}
        {!isLatest && (
          <div className='flex items-center gap-1 rounded-b-xl border-t-[0.5px] border-divider-subtle bg-background-default-subtle px-4 py-3 group-hover:bg-components-panel-on-panel-item-bg-hover'>
            <div className='system-xs-regular text-text-tertiary'>{t('share.chat.memory.notLatestVersion', { num: waitMergeCount })}</div>
            <Indicator color='orange' />
          </div>
        )}
      </div>
      {showEditModal && (
        <MemoryEditModal
          isMobile={isMobile}
          show={showEditModal}
          memory={memory}
          onConfirm={async (info, content) => {
            await updateMemory(info, content)
            setShowEditModal(false)
          }}
          onHide={() => setShowEditModal(false)}
        />
      )}
    </>
  )
}

export default MemoryCard
