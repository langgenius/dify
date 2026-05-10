import type { UseMutationResult } from '@tanstack/react-query'
import type { FC, ReactNode } from 'react'
import type { Plugin } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { memo } from 'react'
import Card from '@/app/components/plugins/card'

type Props = {
  plugin: Plugin
  onCancel: () => void
  mutation: Pick<UseMutationResult, 'isSuccess' | 'isPending'>
  mutate: () => void
  confirmButtonText: ReactNode
  cancelButtonText: ReactNode
  modelTitle: ReactNode
  description: ReactNode
  cardTitleLeft: ReactNode
  modalBottomLeft?: ReactNode
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
  mutate,
  modalBottomLeft,
}: Props) => {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <DialogContent className="w-full min-w-[560px] overflow-hidden! border-none text-left align-middle">
        <DialogCloseButton data-testid="modal-close-button" />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {modelTitle}
        </DialogTitle>

        <div className="mt-3 mb-2 system-md-regular text-text-secondary">
          {description}
        </div>
        <div className="flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2">
          <Card
            installed={mutation.isSuccess}
            payload={plugin}
            className="w-full"
            titleLeft={cardTitleLeft}
          />
        </div>
        <div className="flex items-center gap-2 self-stretch pt-5">
          <div>
            {modalBottomLeft}
          </div>
          <div className="ml-auto flex gap-2">
            {!mutation.isPending && (
              <Button onClick={onCancel}>
                {cancelButtonText}
              </Button>
            )}
            <Button
              variant="primary"
              loading={mutation.isPending}
              onClick={mutate}
              disabled={mutation.isPending}
            >
              {confirmButtonText}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

PluginMutationModal.displayName = 'PluginMutationModal'

export default memo(PluginMutationModal)
