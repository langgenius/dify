import type { FC } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import { useMemo } from 'react'
import { HeaderModals } from '@/app/components/plugins/plugin-detail-panel/detail-header/components'
import { useDetailHeaderState, usePluginOperations } from '@/app/components/plugins/plugin-detail-panel/detail-header/hooks'
import OperationDropdown from '@/app/components/plugins/plugin-detail-panel/operation-dropdown'
import { PluginSource } from '@/app/components/plugins/types'
import PluginVersionPicker from '@/app/components/plugins/update-plugin/plugin-version-picker'
import { useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { cn } from '@/utils/classnames'
import { getMarketplaceUrl } from '@/utils/var'

type Props = {
  detail: PluginDetail
  onUpdate?: () => void
}

const ProviderCardActions: FC<Props> = ({ detail, onUpdate }) => {
  const { theme } = useTheme()
  const locale = useLocale()

  const { source, version, meta } = detail
  const author = detail.declaration?.author ?? ''
  const name = detail.declaration?.name ?? detail.name

  const {
    modalStates,
    versionPicker,
    hasNewVersion,
    isAutoUpgradeEnabled,
    isFromMarketplace,
  } = useDetailHeaderState(detail)

  const {
    handleUpdate,
    handleUpdatedFromMarketplace,
    handleDelete,
  } = usePluginOperations({
    detail,
    modalStates,
    versionPicker,
    isFromMarketplace,
    onUpdate,
  })

  const handleVersionSelect = (state: { version: string, unique_identifier: string, isDowngrade?: boolean }) => {
    versionPicker.setTargetVersion(state)
    handleUpdate(state.isDowngrade)
  }

  const detailUrl = useMemo(() => {
    if (source === PluginSource.github)
      return meta?.repo ? `https://github.com/${meta.repo}` : ''
    if (source === PluginSource.marketplace)
      return getMarketplaceUrl(`/plugins/${author}/${name}`, { language: locale, theme })
    return ''
  }, [source, meta?.repo, author, name, locale, theme])

  return (
    <>
      {!!version && (
        <PluginVersionPicker
          disabled={!isFromMarketplace}
          isShow={versionPicker.isShow}
          onShowChange={versionPicker.setIsShow}
          pluginID={detail.plugin_id}
          currentVersion={version}
          onSelect={handleVersionSelect}
          offset={{ mainAxis: 4, crossAxis: 0 }}
          trigger={(
            <div
              className={cn(
                'relative inline-flex min-w-5 items-center justify-center gap-[3px] rounded-md border border-divider-deep px-[5px] py-[2px] text-text-tertiary system-xs-medium-uppercase',
                versionPicker.isShow && 'bg-state-base-hover',
                isFromMarketplace && 'cursor-pointer hover:bg-state-base-hover',
              )}
            >
              <span>{version}</span>
              {isFromMarketplace && <span className="i-ri-arrow-down-s-line h-3 w-3" />}
              {hasNewVersion && (
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-state-destructive-solid" />
              )}
            </div>
          )}
        />
      )}

      <OperationDropdown
        source={source}
        onInfo={modalStates.showPluginInfo}
        onCheckVersion={() => handleUpdate()}
        onRemove={modalStates.showDeleteConfirm}
        detailUrl={detailUrl}
        placement="bottom-start"
        popupClassName="w-[192px]"
      />

      <HeaderModals
        detail={detail}
        modalStates={modalStates}
        targetVersion={versionPicker.targetVersion}
        isDowngrade={versionPicker.isDowngrade}
        isAutoUpgradeEnabled={isAutoUpgradeEnabled}
        onUpdatedFromMarketplace={handleUpdatedFromMarketplace}
        onDelete={handleDelete}
      />
    </>
  )
}

export default ProviderCardActions
