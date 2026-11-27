import type { BuilderCreationMode } from './pending-prompt'
import { MenuGroupLabel, MenuItem } from '@langgenius/dify-ui/menu'
import { useTranslation } from 'react-i18next'

export function BuilderCreationMenuItems({
  onChoose,
}: {
  onChoose: (mode: BuilderCreationMode) => void
}) {
  const { t } = useTranslation(['app', 'difyBuilder'])
  return (
    <>
      <MenuGroupLabel>{t(($) => $.panelTitle, { ns: 'difyBuilder' })}</MenuGroupLabel>
      <MenuItem onClick={() => onChoose('workflow')}>
        <span aria-hidden className="i-ri-flow-chart size-4 shrink-0" />
        {t(($) => $['types.workflow'], { ns: 'app' })}
      </MenuItem>
      <MenuItem onClick={() => onChoose('advanced-chat')}>
        <span aria-hidden className="i-ri-chat-3-line size-4 shrink-0" />
        {t(($) => $['types.advanced'], { ns: 'app' })}
      </MenuItem>
    </>
  )
}
