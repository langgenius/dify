import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { TONE_LIST } from '@/config'

const PRESET_TONE_LIST = TONE_LIST.slice(0, 3)

const toneI18nKeyMap = {
  Creative: 'model.tone.Creative',
  Balanced: 'model.tone.Balanced',
  Precise: 'model.tone.Precise',
  Custom: 'model.tone.Custom',
} as const

const TONE_ICONS: Record<number, ReactNode> = {
  1: (
    <span
      aria-hidden
      className="mr-2 i-custom-vender-solid-editor-brush-01 h-3.5 w-3.5 text-[#6938EF]"
    />
  ),
  2: (
    <span
      aria-hidden
      className="mr-2 i-custom-vender-solid-FinanceAndECommerce-scales-02 h-3.5 w-3.5 text-indigo-600"
    />
  ),
  3: (
    <span
      aria-hidden
      className="mr-2 i-custom-vender-solid-general-target-04 h-3.5 w-3.5 text-[#107569]"
    />
  ),
}

type PresetsParameterProps = {
  onSelect: (toneId: number) => void
  supportedParameterNames?: string[]
}

function PresetsParameter({ onSelect, supportedParameterNames }: PresetsParameterProps) {
  const { t } = useTranslation(['common'])
  const supportedParameterNameSet = supportedParameterNames
    ? new Set(supportedParameterNames)
    : undefined
  const visiblePresetTones = supportedParameterNameSet
    ? PRESET_TONE_LIST.filter((tone) =>
        Object.keys(tone.config ?? {}).some((key) => supportedParameterNameSet.has(key)),
      )
    : PRESET_TONE_LIST

  if (!visiblePresetTones.length) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="small"
            variant="secondary"
            className="data-popup-open:bg-state-base-hover"
          />
        }
      >
        {t(($) => $['modelProvider.loadPresets'], { ns: 'common' })}
        <span className="i-ri-arrow-down-s-line size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {visiblePresetTones.map((tone) => (
          <DropdownMenuItem key={tone.id} onClick={() => onSelect(tone.id)}>
            {TONE_ICONS[tone.id]}
            {t(($) => $[toneI18nKeyMap[tone.name]], { ns: 'common' })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default PresetsParameter
