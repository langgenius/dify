import type { CredentialSlot } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { PluginCategory } from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'

function providerName(providerId: string) {
  const name = providerId.split('/').filter(Boolean).at(-1) ?? providerId

  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function CredentialField({
  slot,
  value,
  onChange,
}: {
  slot: CredentialSlot
  value?: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tPlugin } = useTranslation('plugin')
  const { getIconUrl } = useGetIcon()
  const { theme } = useTheme()
  const selectedOption = slot.candidates.find((candidate) => candidate.credential_id === value)
  const name = providerName(slot.provider_id)
  const iconFileName =
    theme === Theme.dark ? slot.icon_dark || slot.icon : slot.icon || slot.icon_dark
  const iconSrc = iconFileName ? getIconUrl(iconFileName) : undefined
  const category =
    slot.category === PluginCategory.PLUGIN_CATEGORY_MODEL
      ? tPlugin(($) => $['categorySingle.model'])
      : slot.category === PluginCategory.PLUGIN_CATEGORY_TOOL
        ? tPlugin(($) => $['categorySingle.tool'])
        : ''

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="size-5 shrink-0 overflow-hidden rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge">
          {iconSrc ? (
            <img alt="" src={iconSrc} className="size-full object-contain" />
          ) : (
            <span
              aria-hidden
              className="i-ri-plug-2-line flex size-full items-center justify-center text-text-tertiary"
            />
          )}
        </span>
        <span className="system-sm-medium text-text-primary">{name}</span>
        {category && <span className="system-xs-regular text-text-tertiary">{category}</span>}
      </div>
      <Select
        value={value ?? null}
        disabled={slot.candidates.length === 0}
        onValueChange={(nextValue) => {
          if (nextValue) onChange(nextValue)
        }}
      >
        <SelectTrigger aria-label={name} className="px-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="flex size-4 shrink-0 items-center justify-center">
              <span className="size-2 rounded-[3px] border border-components-badge-status-light-success-border-inner bg-components-badge-status-light-success-bg shadow-status-indicator-green-shadow" />
            </span>
            <span className="truncate">
              {selectedOption?.display_name ??
                (slot.candidates.length === 0
                  ? t(($) => $['deployDrawer.noCredentialCandidates'])
                  : t(($) => $['deployDrawer.selectCredential']))}
            </span>
          </span>
        </SelectTrigger>
        <SelectContent popupClassName="w-(--anchor-width)">
          {slot.candidates.map((candidate) => (
            <SelectItem key={candidate.credential_id} value={candidate.credential_id}>
              <SelectItemText>{candidate.display_name || candidate.credential_id}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
