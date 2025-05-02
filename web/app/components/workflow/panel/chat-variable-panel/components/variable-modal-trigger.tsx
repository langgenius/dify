'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import VariableModal from '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { ConversationVariable } from '@/app/components/workflow/types'

type Props = {
  open: boolean
  setOpen: (value: React.SetStateAction<boolean>) => void
  showTip: boolean
  chatVar?: ConversationVariable
  onClose: () => void
  onSave: (env: ConversationVariable) => void
}

const VariableModalTrigger = ({
  open,
  setOpen,
  showTip,
  chatVar,
  onClose,
  onSave,
}: Props) => {
  const { t } = useTranslation()

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={() => {
        setOpen(v => !v)
        open && onClose()
      }}
      placement='left-start'
      offset={{
        mainAxis: 8,
        alignmentAxis: showTip ? -278 : -48,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => {
        setOpen(v => !v)
        open && onClose()
      }}>
        <Button variant='primary'>
          <RiAddLine className='mr-1 h-4 w-4' />
          <span className='system-sm-medium'>{t('workflow.chatVariable.button')}</span>
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <VariableModal
          chatVar={chatVar}
          onSave={onSave}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default VariableModalTrigger
