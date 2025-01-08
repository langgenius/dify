import type { FC, ReactNode } from 'react'
import React, { memo } from 'react'
import Card from '@/app/components/plugins/card'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import type { Plugin } from '../types'
import type { UseMutationResult } from '@tanstack/react-query'

type Props = {
  plugin: Plugin
  onSave: () => void
  onCancel: () => void
  mutation: UseMutationResult
  confirmButtonText: ReactNode
  cancelButtonText: ReactNode
  modelTitle: ReactNode
  description: ReactNode
  cardTitleLeft: ReactNode
}

const PluginMutationModal: FC<Props> = ({
  plugin,
  onCancel,
  mutation,
  confirmButtonText,
  cancelButtonText,
  modelTitle,
  description,
  cardTitleLeft,
}: Props) => {
  return (
    <Modal
      isShow={true}
      onClose={onCancel}
      className='min-w-[560px]'
      closable
      title={modelTitle}
    >
      <div className='mt-3 mb-2 text-text-secondary system-md-regular'>
        {description}
      </div>
      <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
        <Card
          installed={mutation.isSuccess}
          payload={plugin}
          className='w-full'
          titleLeft={cardTitleLeft}
        />
      </div>
      <div className='flex pt-5 justify-end items-center gap-2 self-stretch'>
        {mutation.isPending && (
          <Button onClick={onCancel}>
            {cancelButtonText}
          </Button>
        )}
        <Button
          variant='primary'
          loading={mutation.isPending}
          onClick={mutation.mutate}
          disabled={mutation.isPending}
        >
          {confirmButtonText}
        </Button>
      </div>
    </Modal>
  )
}

PluginMutationModal.displayName = 'PluginMutationModal'

export default memo(PluginMutationModal)
