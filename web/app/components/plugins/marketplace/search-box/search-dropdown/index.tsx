import type { Plugin } from '@/app/components/plugins/types'
import { useTranslation } from '#i18n'
import { RiArrowRightLine } from '@remixicon/react'
import Loading from '@/app/components/base/loading'
import { useCategories } from '@/app/components/plugins/hooks'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { cn } from '@/utils/classnames'
import { MARKETPLACE_TYPE_ICON_COMPONENTS } from '../../plugin-type-icons'
import { getPluginDetailLinkInMarketplace } from '../../utils'

type SearchDropdownProps = {
  query: string
  plugins: Plugin[]
  onShowAll: () => void
  isLoading?: boolean
}

const SearchDropdown = ({
  query,
  plugins,
  onShowAll,
  isLoading = false,
}: SearchDropdownProps) => {
  const { t } = useTranslation()
  const getValueFromI18nObject = useRenderI18nObject()
  const { categoriesMap } = useCategories(true)

  return (
    <div className="w-[472px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl backdrop-blur-sm">
      <div className="flex flex-col">
        {isLoading && !plugins.length && (
          <div className="flex items-center justify-center py-6">
            <Loading />
          </div>
        )}
        {!!plugins.length && (
          <div className="p-1">
            <div className="system-xs-semibold-uppercase px-3 pb-2 pt-3 text-text-primary">
              {t('marketplace.searchDropdown.plugins', { ns: 'plugin' })}
            </div>
            <div className="flex flex-col">
              {plugins.map((plugin) => {
                const title = getValueFromI18nObject(plugin.label) || plugin.name
                const description = getValueFromI18nObject(plugin.brief) || ''
                const categoryLabel = categoriesMap[plugin.category]?.label || plugin.category
                const installLabel = t('install', { ns: 'plugin', num: plugin.install_count || 0 })
                const author = plugin.org || plugin.author || ''
                const TypeIcon = MARKETPLACE_TYPE_ICON_COMPONENTS[plugin.category]
                return (
                  <a
                    key={`${plugin.org}/${plugin.name}`}
                    className={cn(
                      'flex gap-2 rounded-lg px-3 py-2 hover:bg-state-base-hover',
                    )}
                    href={getPluginDetailLinkInMarketplace(plugin)}
                  >
                    <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge">
                      <img className="h-full w-full object-cover" src={plugin.icon} alt={title} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="system-sm-medium truncate text-text-primary">{title}</div>
                      {!!description && (
                        <div className="system-xs-regular truncate text-text-tertiary">{description}</div>
                      )}
                      <div className="flex items-center gap-1.5 pt-0.5 text-text-tertiary">
                        <div className="flex items-center gap-1">
                          {TypeIcon && <TypeIcon className="h-4 w-4 text-text-tertiary" />}
                          <span className="system-xs-regular">{categoryLabel}</span>
                        </div>
                        <span className="system-xs-regular">·</span>
                        <span className="system-xs-regular">
                          {t('marketplace.searchDropdown.byAuthor', { ns: 'plugin', author })}
                        </span>
                        <span className="system-xs-regular">·</span>
                        <span className="system-xs-regular">{installLabel}</span>
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-divider-subtle p-1">
        <button
          className="group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left"
          onClick={onShowAll}
          type="button"
        >
          <span className="system-sm-medium text-text-accent">
            {t('marketplace.searchDropdown.showAllResults', { ns: 'plugin', query })}
          </span>
          <span className="flex items-center">
            <span className="system-2xs-medium-uppercase rounded-[5px] border border-divider-deep px-1.5 py-0.5 text-text-tertiary group-hover:hidden">
              {t('marketplace.searchDropdown.enter', { ns: 'plugin' })}
            </span>
            <RiArrowRightLine className="hidden h-5 w-5 text-text-tertiary group-hover:block" />
          </span>
        </button>
      </div>
    </div>
  )
}

export default SearchDropdown
