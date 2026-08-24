import type { CredentialSlot } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { PluginCategory } from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
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
        onValueChange={(nextValue) => {
          if (nextValue) onChange(nextValue)
        }}
      >
        <SelectTrigger aria-label={name} className="px-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusDot />
            <span className="truncate">
              {selectedOption?.display_name ??
                (slot.candidates.length === 0
                  ? t(($) => $['deployDrawer.noCredentialCandidates'])
                  : t(($) => $['deployDrawer.selectCredential']))}
            </span>
          </span>
        </SelectTrigger>
        <SelectContent className="w-(--anchor-width) bg-components-panel-bg-blur backdrop-blur-[5px]">
          {slot.candidates.length === 0 ? (
            <div className="flex w-full flex-col items-start gap-2 rounded-[10px] bg-workflow-process-bg px-4 pt-4 pb-5">
              <div className="flex size-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-[5px]">
                <span aria-hidden className="i-ri-key-2-line size-5 text-text-tertiary" />
              </div>
              <div className="wrap-break-words flex w-full flex-col items-start gap-1">
                <p className="w-full system-sm-medium text-text-secondary">
                  {t(($) => $['studio.noCredentialsYet'])}
                </p>
                <p className="w-full system-xs-regular text-text-tertiary">
                  {t(($) => $['studio.noCredentialsYetDescription'])}
                </p>
              </div>
            </div>
          ) : (
            <SelectGroup className="py-1">
              <SelectGroupLabel>{t(($) => $['deployDrawer.runtimeCredentials'])}</SelectGroupLabel>
              {slot.candidates.map((candidate) => (
                <SelectItem
                  key={candidate.credential_id}
                  value={candidate.credential_id}
                  className="h-8 gap-1.5 py-1 pr-1 pl-3 system-md-regular data-selected:bg-state-base-hover"
                >
                  <span className="flex size-2 shrink-0 items-center justify-center">
                    <StatusDot size="small" />
                  </span>
                  <SelectItemText className="me-0 px-0 system-md-regular">
                    {candidate.display_name || candidate.credential_id}
                  </SelectItemText>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
