import type { FC } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
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
  const { t } = useTranslation()
  const { theme } = useTheme()
  const locale = useLocale()

  const { source, version, latest_version, latest_unique_identifier, meta } = detail
  const author = detail.declaration?.author ?? ''
  const name = detail.declaration?.name ?? detail.name

  const {
    modalStates,
    versionPicker,
    hasNewVersion,
    isAutoUpgradeEnabled,
    isFromMarketplace,
    isFromGitHub,
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

  const handleTriggerLatestUpdate = () => {
    if (isFromMarketplace) {
      versionPicker.setTargetVersion({
        version: latest_version,
        unique_identifier: latest_unique_identifier,
      })
    }
    handleUpdate()
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
          sideOffset={4}
          alignOffset={0}
          trigger={(
            <Badge
              className={cn(
                isFromMarketplace && 'cursor-pointer hover:bg-state-base-hover',
              )}
              uppercase={false}
              text={(
                <>
                  <span>{version}</span>
                  {isFromMarketplace && <span className="i-ri-arrow-left-right-line ml-1 h-3 w-3" />}
                </>
              )}
              hasRedCornerMark={hasNewVersion}
            />
          )}
        />
      )}

      {(hasNewVersion || isFromGitHub) && (
        <Tooltip>
          <TooltipTrigger
            delay={300}
            render={(
              <Button
                variant="secondary-accent"
                size="small"
                className="!h-5"
                onClick={handleTriggerLatestUpdate}
              >
                {t('detailPanel.operation.update', { ns: 'plugin' })}
              </Button>
            )}
          />
          <TooltipContent>
            {t('detailPanel.operation.updateTooltip', { ns: 'plugin' })}
          </TooltipContent>
        </Tooltip>
      )}

      <OperationDropdown
        source={source}
        onInfo={modalStates.showPluginInfo}
        onCheckVersion={() => handleUpdate()}
        onRemove={modalStates.showDeleteConfirm}
        detailUrl={detailUrl}
        placement="bottom-start"
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
