import type { MouseEventHandler } from 'react'
import type { ChecklistItem } from '../../hooks/use-checklist'
import type { BlockEnum } from '../../types'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import BlockIcon from '../../block-icon'
import { ItemIndicator } from './item-indicator'

export const ChecklistPluginGroup = memo(({
  items,
}: {
  items: ChecklistItem[]
}) => {
  const { t } = useTranslation()
  const install = useInstallPackageFromMarketPlace()
  const [installing, setInstalling] = useState(false)

  const identifiers = useMemo(
    () => items
      .map(i => i.pluginUniqueIdentifier)
      .filter((id): id is string => Boolean(id)),
    [items],
  )

  const handleInstallAll: MouseEventHandler = async (e) => {
    e.stopPropagation()
    if (installing || identifiers.length === 0)
      return
    setInstalling(true)
    for (const id of identifiers) {
      try {
        const response = await install.mutateAsync(id)
        if (response?.task_id) {
          const { check } = checkTaskStatus()
          await check({ taskId: response.task_id, pluginUniqueIdentifier: id })
        }
      }
      catch {
        // continue installing remaining plugins
      }
    }
    setInstalling(false)
    install.reset()
  }

  return (
    <div className="overflow-clip rounded-[10px] bg-components-panel-on-panel-item-bg">
      <div className="flex items-center gap-2 px-2 pt-2">
        <div className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-icon-bg-midnight-solid shadow-xs">
          <span className="i-ri-download-line size-3.5 text-white" />
        </div>
        <span className="min-w-0 grow truncate text-sm font-medium leading-5 text-text-primary">
          {t('nodes.common.pluginsNotInstalled', { ns: 'workflow', count: items.length })}
        </span>
        <Button
          variant="secondary"
          size="small"
          onClick={handleInstallAll}
          disabled={installing || identifiers.length === 0}
        >
          {installing
            ? (
                <>
                  {t('nodes.agent.pluginInstaller.installing', { ns: 'workflow' })}
                  <span className="i-ri-loader-2-line ml-1 size-3 animate-spin" />
                </>
              )
            : t('nodes.agent.pluginInstaller.install', { ns: 'workflow' })}
        </Button>
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
