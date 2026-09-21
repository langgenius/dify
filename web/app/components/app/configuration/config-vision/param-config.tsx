'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiSettings2Line } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import ParamConfigContent from './param-config-content'

const ParamsConfig: FC = () => {
  const { t } = useTranslation()

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="small">
            <RiSettings2Line className="size-3.5" />
            <div>{t(($) => $['voice.settings'], { ns: 'appDebug' })}</div>
          </Button>
        }
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        className="border-none bg-transparent shadow-none"
      >
        <div className="w-80 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-lg sm:w-103">
          <PopoverTitle className="text-base/6 font-semibold text-text-primary">
            {t(($) => $['vision.visionSettings.title'], { ns: 'appDebug' })}
          </PopoverTitle>
          <ParamConfigContent />
        </div>
      </PopoverContent>
    </Popover>
  )
}
export default memo(ParamsConfig)
