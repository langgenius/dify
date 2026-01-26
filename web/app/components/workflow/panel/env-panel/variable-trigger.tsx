'use client'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { RiAddLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
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

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={() => {
        setOpen(v => !v)
        if (open)
          onClose()
      }}
      placement="left-start"
      offset={{
        mainAxis: 8,
        alignmentAxis: -104,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => {
        setOpen(v => !v)
        if (open)
          onClose()
      }}
      >
        <Button variant="primary">
          <RiAddLine className="mr-1 h-4 w-4" />
          <span className="system-sm-medium">{t('env.envPanelButton', { ns: 'workflow' })}</span>
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[11]">
        <VariableModal
          env={env}
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

export default VariableTrigger
