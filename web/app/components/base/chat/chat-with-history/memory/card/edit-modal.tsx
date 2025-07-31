'use client'
import React from 'react'
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
import type { MemoryItem } from '../type'
import { noop } from 'lodash-es'
import cn from '@/utils/classnames'

type Props = {
  memory: MemoryItem
  show: boolean
  onConfirm: (info: MemoryItem) => Promise<void>
  onHide: () => void
}

const MemoryEditModal = ({
  memory,
  show = false,
  onConfirm,
  onHide,
}: Props) => {
  const { t } = useTranslation()
  const [content, setContent] = React.useState(memory.content)

  const submit = () => {
    if (!content.trim()) {
      Toast.notify({ type: 'error', message: 'content is required' })
      return
    }
    onConfirm({ ...memory, content })
    onHide()
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
          <div className='system-sm-semibold truncate text-text-primary'>{memory.name}</div>
          <Badge text={`${t('share.chat.memory.updateVersion.update')} 2`} />
        </div>
      </div>
      <div className='px-6'>
        <Textarea
          className='h-[562px]'
          value={content}
          onChange={e => setContent(e.target.value)}
        />
      </div>
      <div className='flex flex-row-reverse p-6 pt-5'>
        <Button className='ml-2' variant='primary' onClick={submit}>{t('share.chat.memory.operations.save')}</Button>
        <Button className='ml-3' onClick={onHide}>{t('share.chat.memory.operations.cancel')}</Button>
        <Divider type='vertical' className='!mx-0 !h-4' />
        <Button className='mr-3' onClick={onHide}>{t('share.chat.memory.operations.reset')}</Button>
      </div>
    </Modal>
  )
}

export default MemoryEditModal
