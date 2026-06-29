import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from '#i18n'
import { Brush01 } from '@/app/components/base/icons/src/vender/solid/editor'
import { Scales02 } from '@/app/components/base/icons/src/vender/solid/FinanceAndECommerce'
import { Target04 } from '@/app/components/base/icons/src/vender/solid/general'
import { TONE_LIST } from '@/config'

const PRESET_TONE_LIST = TONE_LIST.slice(0, 3)

const toneI18nKeyMap = {
  Creative: 'model.tone.Creative',
  Balanced: 'model.tone.Balanced',
  Precise: 'model.tone.Precise',
  Custom: 'model.tone.Custom',
} as const

const TONE_ICONS: Record<number, ReactNode> = {
  1: <Brush01 className="mr-2 h-[14px] w-[14px] text-[#6938EF]" />,
  2: <Scales02 className="mr-2 h-[14px] w-[14px] text-indigo-600" />,
  3: <Target04 className="mr-2 h-[14px] w-[14px] text-[#107569]" />,
}

type PresetsParameterProps = {
  onSelect: (toneId: number) => void
  supportedParameterNames?: string[]
}

function PresetsParameter({ onSelect, supportedParameterNames }: PresetsParameterProps) {
  const { t } = useTranslation()
  const supportedParameterNameSet = supportedParameterNames ? new Set(supportedParameterNames) : undefined
  const visiblePresetTones = supportedParameterNameSet
    ? PRESET_TONE_LIST.filter(tone => Object.keys(tone.config ?? {}).some(key => supportedParameterNameSet.has(key)))
    : PRESET_TONE_LIST

  if (!visiblePresetTones.length)
    return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            size="small"
            variant="secondary"
            className="data-popup-open:bg-state-base-hover"
          />
        )}
      >
        {t('modelProvider.loadPresets', { ns: 'common' })}
        <span className="ml-0.5 i-ri-arrow-down-s-line size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {visiblePresetTones.map(tone => (
          <DropdownMenuItem key={tone.id} onClick={() => onSelect(tone.id)}>
            {TONE_ICONS[tone.id]}
            {t(toneI18nKeyMap[tone.name], { ns: 'common' })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default PresetsParameter
