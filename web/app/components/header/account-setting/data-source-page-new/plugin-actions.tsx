'use client'

import type { PluginDetail } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { HeaderModals } from '@/app/components/plugins/plugin-detail-panel/detail-header/components'
import { useDetailHeaderState, usePluginOperations } from '@/app/components/plugins/plugin-detail-panel/detail-header/hooks'
import OperationDropdown from '@/app/components/plugins/plugin-detail-panel/operation-dropdown'
import { useReadmePanelStore } from '@/app/components/plugins/readme-panel/store'
import { PluginSource } from '@/app/components/plugins/types'
import PluginVersionPicker from '@/app/components/plugins/update-plugin/plugin-version-picker'
import { useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { getMarketplaceUrl } from '@/utils/var'

type Props = {
  detail: PluginDetail
  onUpdate?: (isDelete?: boolean) => void
}

const usePluginDetailHeader = useDetailHeaderState

const getDetailUrl = (
  detail: PluginDetail,
  locale: string,
  theme: string,
) => {
  const { source, meta } = detail
  const { author, name } = detail.declaration || detail

  if (source === PluginSource.github)
    return meta?.repo ? `https://github.com/${meta.repo}` : ''

  if (source === PluginSource.marketplace)
    return getMarketplaceUrl(`/plugins/${author}/${name}`, { language: locale, theme })

  return ''
}

const DataSourcePluginActions = ({
  detail,
  onUpdate,
}: Props) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const locale = useLocale()
  const readmeTriggerId = useId()
  const openReadmePanel = useReadmePanelStore(s => s.openReadmePanel)
  const detailHeaderState = usePluginDetailHeader(detail)
  const {
    modalStates,
    versionPicker,
    hasNewVersion,
    isAutoUpgradeEnabled,
    isFromGitHub,
    isFromMarketplace,
  } = detailHeaderState
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
  const displayVersion = isFromGitHub ? (detail.meta?.version ?? detail.version) : detail.version

  const handleVersionSelect = (state: { version: string, unique_identifier: string, isDowngrade?: boolean }) => {
    versionPicker.setTargetVersion(state)
    handleUpdate(state.isDowngrade)
  }

  const handleTriggerLatestUpdate = () => {
    if (isFromMarketplace) {
      versionPicker.setTargetVersion({
        version: detail.latest_version,
        unique_identifier: detail.latest_unique_identifier,
      })
    }
    handleUpdate()
  }
  const handleViewReadme = () => {
    openReadmePanel({
      detail,
      triggerId: readmeTriggerId,
    })
  }

  return (
    <div className="flex shrink-0 items-center gap-1" onClick={e => e.stopPropagation()}>
      {!!displayVersion && (
        <PluginVersionPicker
          disabled={!isFromMarketplace}
          isShow={versionPicker.isShow}
          onShowChange={versionPicker.setIsShow}
          pluginID={detail.plugin_id}
          currentVersion={detail.version}
          onSelect={handleVersionSelect}
          trigger={(
            <Badge
              className="h-5 px-1.5"
              text={(
                <>
                  <div>{displayVersion}</div>
                  {isFromMarketplace && <span aria-hidden className="ml-1 i-ri-arrow-left-right-line h-3 w-3 shrink-0 text-text-tertiary" />}
                </>
              )}
              hasRedCornerMark={hasNewVersion}
              uppercase={false}
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
                className="h-5 rounded-md px-1.5 py-0 system-xs-medium"
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
        source={detail.source}
        onInfo={modalStates.showPluginInfo}
        onCheckVersion={handleUpdate}
        onRemove={modalStates.showDeleteConfirm}
        onViewReadme={detail.plugin_unique_identifier ? handleViewReadme : undefined}
        detailUrl={getDetailUrl(detail, locale, theme || 'light')}
        triggerSize="xs"
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
    </div>
  )
}

export default memo(DataSourcePluginActions)
