import type { FC } from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

type MethodSelectorProps = {
  value?: string
  onChange: (v: string) => void
}
const MethodSelector: FC<MethodSelectorProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={4}
    >
      <div className="relative">
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
          className="block"
        >
          <div className={cn(
            'flex h-9 min-h-[56px] cursor-pointer items-center gap-1 bg-transparent px-3 py-2 hover:bg-background-section-burn',
            open && '!bg-background-section-burn hover:bg-background-section-burn',
          )}
          >
            <div className={cn('grow truncate text-[13px] leading-[18px] text-text-secondary')}>
              {value === 'llm' ? t('createTool.toolInput.methodParameter', { ns: 'tools' }) : t('createTool.toolInput.methodSetting', { ns: 'tools' })}
            </div>
            <div className="ml-1 shrink-0 text-text-secondary opacity-60">
              <RiArrowDownSLine className="h-4 w-4" />
            </div>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[1040]">
          <div className="relative w-[320px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg  backdrop-blur-sm">
            <div className="p-1">
              <div className="cursor-pointer rounded-lg py-2.5 pl-3 pr-2 hover:bg-components-panel-on-panel-item-bg-hover" onClick={() => onChange('llm')}>
                <div className="item-center flex gap-1">
                  <div className="h-4 w-4 shrink-0">
                    {value === 'llm' && <Check className="h-4 w-4 shrink-0 text-text-accent" />}
                  </div>
                  <div className="text-[13px] font-medium leading-[18px] text-text-secondary">{t('createTool.toolInput.methodParameter', { ns: 'tools' })}</div>
                </div>
                <div className="pl-5 text-[13px] leading-[18px] text-text-tertiary">{t('createTool.toolInput.methodParameterTip', { ns: 'tools' })}</div>
              </div>
              <div className="cursor-pointer rounded-lg py-2.5 pl-3 pr-2 hover:bg-components-panel-on-panel-item-bg-hover" onClick={() => onChange('form')}>
                <div className="item-center flex gap-1">
                  <div className="h-4 w-4 shrink-0">
                    {value === 'form' && <Check className="h-4 w-4 shrink-0 text-text-accent" />}
                  </div>
                  <div className="text-[13px] font-medium leading-[18px] text-text-secondary">{t('createTool.toolInput.methodSetting', { ns: 'tools' })}</div>
                </div>
                <div className="pl-5 text-[13px] leading-[18px] text-text-tertiary">{t('createTool.toolInput.methodSettingTip', { ns: 'tools' })}</div>
              </div>
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default MethodSelector
