'use client'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiAddLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import VariableModal from '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal'

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
  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen)
      onClose()
  }, [onClose, setOpen])

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger
        render={(
          <Button variant="primary">
            <RiAddLine className="mr-1 h-4 w-4" />
            <span className="system-sm-medium">{t('chatVariable.button', { ns: 'workflow' })}</span>
          </Button>
        )}
      />
      <PopoverContent
        placement="left-start"
        sideOffset={8}
        alignOffset={showTip ? -278 : -48}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <VariableModal
          chatVar={chatVar}
          onSave={onSave}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export default VariableModalTrigger
