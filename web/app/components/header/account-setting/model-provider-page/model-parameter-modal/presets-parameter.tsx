import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
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
      className="me-2 i-custom-vender-solid-editor-brush-01 h-3.5 w-3.5 text-[#6938EF]"
    />
  ),
  2: (
    <span
      aria-hidden
      className="me-2 i-custom-vender-solid-FinanceAndECommerce-scales-02 h-3.5 w-3.5 text-indigo-600"
    />
  ),
  3: (
    <span
      aria-hidden
      className="me-2 i-custom-vender-solid-general-target-04 h-3.5 w-3.5 text-[#107569]"
    />
  ),
}

type PresetsParameterProps = {
  onSelect: (toneId: number) => void
  supportedParameterNames?: string[]
}

function PresetsParameter({ onSelect, supportedParameterNames }: PresetsParameterProps) {
  const { t } = useTranslation(['common', 'modelProvider'])
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
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="small"
            variant="secondary"
            className="data-popup-open:bg-state-base-hover"
          />
        }
      >
        {t(($) => $['modelProvider.loadPresets'], { ns: 'modelProvider' })}
        <span className="i-ri-arrow-down-s-line size-3.5" />
      </MenuTrigger>
      <MenuContent>
        {visiblePresetTones.map((tone) => (
          <MenuItem key={tone.id} onClick={() => onSelect(tone.id)}>
            {TONE_ICONS[tone.id]}
            {t(($) => $[toneI18nKeyMap[tone.name]], { ns: 'common' })}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

export default PresetsParameter
