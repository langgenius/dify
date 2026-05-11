import type { PluginDetail } from '../types'
import type { ReadmePanelPresentation } from './store'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { BUILTIN_TOOLS_ARRAY } from './constants'
import { useReadmePanelStore } from './store'

export const ReadmeEntrance = ({
  pluginDetail,
  presentation = 'drawer',
  className,
  showShortTip = false,
}: {
  pluginDetail: PluginDetail
  presentation?: ReadmePanelPresentation
  className?: string
  showShortTip?: boolean
}) => {
  const { t } = useTranslation()
  const triggerId = useId()
  const openReadmePanel = useReadmePanelStore(s => s.openReadmePanel)

  const handleReadmeClick = () => {
    if (pluginDetail) {
      openReadmePanel({
        detail: pluginDetail,
        presentation,
        triggerId,
      })
    }
  }
  if (!pluginDetail || !pluginDetail?.plugin_unique_identifier || BUILTIN_TOOLS_ARRAY.includes(pluginDetail.id))
    return null

  return (
    <div className={cn('flex flex-col items-start justify-center gap-2 pt-0 pb-4', presentation === 'drawer' && 'px-4', className)}>
      {!showShortTip && (
        <div className="relative h-1 w-8 shrink-0">
          <div className="h-px w-full bg-divider-regular"></div>
        </div>
      )}

      <button
        id={triggerId}
        type="button"
        onClick={handleReadmeClick}
        className="flex w-full items-center justify-start gap-1 rounded-sm text-text-tertiary transition-opacity hover:text-text-accent-light-mode-only focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden"
      >
        <div className="relative flex h-3 w-3 items-center justify-center overflow-hidden">
          <span aria-hidden="true" className="i-ri-book-read-line h-3 w-3" />
        </div>
        <span className="text-xs leading-4 font-normal">
          {!showShortTip ? t('readmeInfo.needHelpCheckReadme', { ns: 'plugin' }) : t('readmeInfo.title', { ns: 'plugin' })}
        </span>
      </button>
    </div>
  )
}
