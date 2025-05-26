'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Textarea from '@/app/components/base/textarea'
import Divider from '@/app/components/base/divider'
import MCPServerParamItem from '@/app/components/tools/mcp/mcp-server-param-item'
import cn from '@/utils/classnames'

export type ModalProps = {
  latestParams?: any
  data?: any
  show: boolean
  onConfirm: () => void
  onHide: () => void
}

const MCPServerModal = ({
  // latestParams,
  data,
  show,
  onConfirm,
  onHide,
}: ModalProps) => {
  const { t } = useTranslation()

  const [description, setDescription] = React.useState('')

  const submit = async () => {
    await onConfirm()
    onHide()
  }

  return (
    <Modal
      isShow={show}
      onClose={onHide}
      className={cn('relative !max-w-[520px] !p-0')}
    >
      <div className='absolute right-5 top-5 z-10 cursor-pointer p-1.5' onClick={onHide}>
        <RiCloseLine className='h-5 w-5 text-text-tertiary' />
      </div>
      <div className='title-2xl-semi-bold relative p-6 pb-3 text-xl text-text-primary'>
        {!data ? t('tools.mcp.server.modal.addTitle') : t('tools.mcp.server.modal.editTitle')}
      </div>
      <div className='space-y-5 px-6 py-3'>
        <div className='space-y-0.5'>
          <div className='flex h-6 items-center gap-1'>
            <div className='system-sm-medium text-text-secondary'>{t('tools.mcp.server.modal.description')}</div>
            <div className='system-xs-regular text-text-destructive-secondary'>*</div>
          </div>
          <Textarea
            className='h-[96px] resize-none'
            value={description}
            placeholder={t('tools.mcp.server.modal.descriptionPlaceholder')}
            onChange={e => setDescription(e.target.value)}
          ></Textarea>
        </div>
        <div>
          <div className='mb-1 flex items-center gap-2'>
            <div className='system-xs-medium-uppercase text-text-primary'>{t('tools.mcp.server.modal.parameters')}</div>
            <Divider type='horizontal' className='!m-0 !h-px grow bg-divider-subtle' />
          </div>
          <div className='body-xs-regular mb-2 text-text-tertiary'>{t('tools.mcp.server.modal.parametersTip')}</div>
          <div className='space-y-3'>
            <MCPServerParamItem
              data={{}}
              onChange={() => ({})}
            />
          </div>
        </div>
      </div>
      <div className='flex flex-row-reverse p-6 pt-5'>
        <Button disabled={!description } className='ml-2' variant='primary' onClick={submit}>{data ? t('tools.mcp.modal.save') : t('tools.mcp.server.modal.confirm')}</Button>
        <Button onClick={onHide}>{t('tools.mcp.modal.cancel')}</Button>
      </div>
    </Modal>
  )
}

export default MCPServerModal
