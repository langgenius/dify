'use client'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import { Memory } from '@/app/components/base/icons/src/vender/line/others'
import Modal from '@/app/components/base/modal'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import Textarea from '@/app/components/base/textarea'
import Divider from '@/app/components/base/divider'
import Toast from '@/app/components/base/toast'
import type { Memory as MemoryItem } from '@/app/components/base/chat/types'
import { noop } from 'lodash-es'
import cn from '@/utils/classnames'

type Props = {
  memory: MemoryItem
  show: boolean
  onConfirm: (info: MemoryItem, content: string) => Promise<void>
  onHide: () => void
  isMobile?: boolean
}

const MemoryEditModal = ({
  memory,
  show = false,
  onConfirm,
  onHide,
  isMobile,
}: Props) => {
  const { t } = useTranslation()
  const [content, setContent] = React.useState(memory.value)

  const versionTag = useMemo(() => {
    const res = `${t('share.chat.memory.updateVersion.update')} ${memory.version}`
    if (memory.edited_by_user)
      return `${res} · ${t('share.chat.memory.updateVersion.edited')}`
    return res
  }, [memory.version, t])

  const reset = () => {
    setContent(memory.value)
  }

  const submit = () => {
    if (!content.trim()) {
      Toast.notify({ type: 'error', message: 'content is required' })
      return
    }
    onConfirm(memory, content)
    onHide()
  }

  if (isMobile) {
    return (
      <div className='fixed inset-0 z-50 flex flex-col bg-background-overlay pt-3 backdrop-blur-sm'
        onClick={onHide}
      >
        <div className='relative flex w-full grow flex-col rounded-t-xl bg-components-panel-bg shadow-xl' onClick={e => e.stopPropagation()}>
          <div className='absolute right-4 top-4 cursor-pointer p-2'>
            <ActionButton onClick={onHide}>
              <RiCloseLine className='h-5 w-5' />
            </ActionButton>
          </div>
          <div className='p-4 pb-3'>
            <div className='title-2xl-semi-bold mb-2 text-text-primary'>{t('share.chat.memory.editTitle')}</div>
            <div className='flex items-center gap-1 pb-1 pt-2'>
              <Memory className='h-4 w-4 shrink-0 text-util-colors-teal-teal-700' />
              <div className='system-sm-semibold truncate text-text-primary'>{memory.spec.name}</div>
              {memory.version > 1 && <Badge text={versionTag} className='!h-4' />}
            </div>
          </div>
          <div className='grow px-4'>
            <Textarea
              className='h-full'
              value={content}
              onChange={e => setContent(e.target.value)}
            />
          </div>
          <div className='flex flex-row-reverse items-center p-4'>
            <Button className='ml-2' variant='primary' onClick={submit}>{t('share.chat.memory.operations.save')}</Button>
            <Button className='ml-3' onClick={onHide}>{t('share.chat.memory.operations.cancel')}</Button>
            <Divider type='vertical' className='!mx-0 !h-4' />
            <Button className='mr-3' onClick={reset}>{t('share.chat.memory.operations.reset')}</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Modal
      isShow={show}
      onClose={noop}
      className={cn('relative !max-w-[800px]', 'p-0')}
    >
      <div className='absolute right-5 top-5 cursor-pointer p-2'>
        <ActionButton onClick={onHide}>
          <RiCloseLine className='h-5 w-5' />
        </ActionButton>
      </div>
      <div className='p-6 pb-3'>
        <div className='title-2xl-semi-bold mb-2 text-text-primary'>{t('share.chat.memory.editTitle')}</div>
        <div className='flex items-center gap-1 pb-1 pt-2'>
          <Memory className='h-4 w-4 shrink-0 text-util-colors-teal-teal-700' />
          <div className='system-sm-semibold truncate text-text-primary'>{memory.spec.name}</div>
          {memory.version > 1 && <Badge text={versionTag} />}
        </div>
      </div>
      <div className='px-6'>
        <Textarea
          className='h-[562px]'
          value={content}
          onChange={e => setContent(e.target.value)}
        />
      </div>
      <div className='flex flex-row-reverse items-center p-6 pt-5'>
        <Button className='ml-2' variant='primary' onClick={submit}>{t('share.chat.memory.operations.save')}</Button>
        <Button className='ml-3' onClick={onHide}>{t('share.chat.memory.operations.cancel')}</Button>
        <Divider type='vertical' className='!mx-0 !h-4' />
        <Button className='mr-3' onClick={reset}>{t('share.chat.memory.operations.reset')}</Button>
      </div>
    </Modal>
  )
}

export default MemoryEditModal
