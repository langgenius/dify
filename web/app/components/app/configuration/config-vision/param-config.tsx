'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RiSettings2Line } from '@remixicon/react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/base/ui/popover'
import ParamConfigContent from './param-config-content'

const ParamsConfig: FC = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        render={(
          <Button variant="ghost" size="small" className={cn('')}>
            <RiSettings2Line className="h-3.5 w-3.5" />
            <div className="ml-1">{t('voice.settings', { ns: 'appDebug' })}</div>
          </Button>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-80 space-y-3 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-lg sm:w-[412px]">
          <ParamConfigContent />
        </div>
      </PopoverContent>
    </Popover>
  )
}
export default memo(ParamsConfig)
