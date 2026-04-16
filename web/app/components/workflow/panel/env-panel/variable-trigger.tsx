'use client'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { RiAddLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/base/ui/popover'
import VariableModal from '@/app/components/workflow/panel/env-panel/variable-modal'

type Props = {
  open: boolean
  setOpen: (value: React.SetStateAction<boolean>) => void
  env?: EnvironmentVariable
  onClose: () => void
  onSave: (env: EnvironmentVariable) => void
}

const VariableTrigger = ({
  open,
  setOpen,
  env,
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
            <span className="system-sm-medium">{t('env.envPanelButton', { ns: 'workflow' })}</span>
          </Button>
        )}
      />
      <PopoverContent
        placement="left-start"
        sideOffset={8}
        alignOffset={-104}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <VariableModal
          env={env}
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

export default VariableTrigger
