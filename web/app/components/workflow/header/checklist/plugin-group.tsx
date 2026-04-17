import type { ChecklistItem } from '../../hooks/use-checklist'
import type { BlockEnum } from '../../types'
import type { Dependency } from '@/app/components/plugins/types'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import { PopoverClose } from '@/app/components/base/ui/popover'
import BlockIcon from '../../block-icon'
import { useStore as usePluginDependencyStore } from '../../plugin-dependency/store'
import { ItemIndicator } from './item-indicator'

function getVersionFromMarketplaceIdentifier(identifier: string): string | undefined {
  const withoutHash = identifier.split('@')[0]
  const [, version] = withoutHash!.split(':')
  return version || undefined
}

export const ChecklistPluginGroup = memo(({
  items,
}: {
  items: ChecklistItem[]
}) => {
  const { t } = useTranslation()

  const identifiers = useMemo(
    () => Array.from(
      new Set(
        items
          .map(i => i.pluginUniqueIdentifier)
          .filter((id): id is string => Boolean(id)),
      ),
    ),
    [items],
  )

  const dependencies = useMemo<Dependency[]>(() => {
    return identifiers.map((identifier) => {
      return {
        type: 'marketplace',
        value: {
          marketplace_plugin_unique_identifier: identifier,
          plugin_unique_identifier: identifier,
          version: getVersionFromMarketplaceIdentifier(identifier),
        },
      }
    })
  }, [identifiers])

  const handleInstallAll = () => {
    if (dependencies.length === 0)
      return
    const { setDependencies } = usePluginDependencyStore.getState()
    setDependencies(dependencies)
  }

  return (
    <div className="overflow-clip rounded-[10px] bg-components-panel-on-panel-item-bg">
      <div className="flex items-center gap-2 px-2 pt-2">
        <div className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-icon-bg-midnight-solid shadow-xs">
          <span className="i-ri-download-line size-3.5 text-white" />
        </div>
        <span className="min-w-0 grow truncate text-sm leading-5 font-medium text-text-primary">
          {t('nodes.common.pluginsNotInstalled', { ns: 'workflow', count: items.length })}
        </span>
        <PopoverClose
          render={(
            <Button
              variant="secondary"
              size="small"
              onClick={handleInstallAll}
              disabled={dependencies.length === 0}
            />
          )}
        >
          {t('nodes.agent.pluginInstaller.install', { ns: 'workflow' })}
        </PopoverClose>
      </div>
      <div className="p-1">
        {items.map(item => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-lg px-1"
          >
            <ItemIndicator />
            <BlockIcon
              type={item.type as BlockEnum}
              size="xs"
              toolIcon={item.toolIcon}
            />
            <span className="min-w-0 grow truncate text-xs leading-4 text-text-warning">
              {item.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
})
ChecklistPluginGroup.displayName = 'ChecklistPluginGroup'
