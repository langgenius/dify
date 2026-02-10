import type { Creator, Template } from '../../types'
import type { Plugin } from '@/app/components/plugins/types'
import { useTranslation } from '#i18n'
import { RiArrowRightLine } from '@remixicon/react'
import { Fragment } from 'react'
import Loading from '@/app/components/base/loading'
import { useCategories } from '@/app/components/plugins/hooks'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { MARKETPLACE_TYPE_ICON_COMPONENTS } from '../../plugin-type-icons'
import { getCreatorAvatarUrl, getPluginDetailLinkInMarketplace } from '../../utils'
import { getMarketplaceUrl } from '@/utils/var'

const DROPDOWN_PANEL = 'w-[472px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl backdrop-blur-sm'
const ICON_BOX_BASE = 'flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge'

const DropdownSection = ({ title, children }: { title: string, children: React.ReactNode }) => (
  <div className="p-1">
    <div className="system-xs-semibold-uppercase px-3 pb-2 pt-3 text-text-primary">{title}</div>
    <div className="flex flex-col">{children}</div>
  </div>
)

const DropdownItem = ({ href, icon, children }: {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
}) => (
  <a className="flex gap-2 rounded-lg px-3 py-2 hover:bg-state-base-hover" href={href}>
    {icon}
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
  </a>
)

const IconBox = ({ shape, className, children }: {
  shape: 'rounded-lg' | 'rounded-full'
  className?: string
  children: React.ReactNode
}) => (
  <div className={`${ICON_BOX_BASE} ${shape} ${className ?? ''}`}>
    {children}
  </div>
)

const ItemMeta = ({ items }: { items: (React.ReactNode | string)[] }) => (
  <div className="flex items-center gap-1.5 pt-0.5 text-text-tertiary">
    {items.filter(Boolean).map((item, i) => (
      <Fragment key={i}>
        {i > 0 && <span className="system-xs-regular">·</span>}
        {typeof item === 'string' ? <span className="system-xs-regular">{item}</span> : item}
      </Fragment>
    ))}
  </div>
)

type SearchDropdownProps = {
  query: string
  plugins: Plugin[]
  templates: Template[]
  creators: Creator[]
  onShowAll: () => void
  isLoading?: boolean
}

const SearchDropdown = ({
  query,
  plugins,
  templates,
  creators,
  onShowAll,
  isLoading = false,
}: SearchDropdownProps) => {
  const { t } = useTranslation()
  const getValueFromI18nObject = useRenderI18nObject()
  const { categoriesMap } = useCategories(true)

  const hasResults = plugins.length > 0 || templates.length > 0 || creators.length > 0

  return (
    <div className={DROPDOWN_PANEL}>
      <div className="flex flex-col">
        {isLoading && !hasResults && (
          <div className="flex items-center justify-center py-6">
            <Loading />
          </div>
        )}

        {plugins.length > 0 && (
          <DropdownSection title={t('marketplace.searchDropdown.plugins', { ns: 'plugin' })}>
            {plugins.map((plugin) => {
              const title = getValueFromI18nObject(plugin.label) || plugin.name
              const description = getValueFromI18nObject(plugin.brief) || ''
              const categoryLabel = categoriesMap[plugin.category]?.label || plugin.category
              const installLabel = t('install', { ns: 'plugin', num: plugin.install_count || 0 })
              const author = plugin.org || plugin.author || ''
              const TypeIcon = MARKETPLACE_TYPE_ICON_COMPONENTS[plugin.category]
              const categoryNode = (
                <div className="flex items-center gap-1">
                  {TypeIcon && <TypeIcon className="h-4 w-4 text-text-tertiary" />}
                  <span>{categoryLabel}</span>
                </div>
              )
              return (
                <DropdownItem
                  key={`${plugin.org}/${plugin.name}`}
                  href={getPluginDetailLinkInMarketplace(plugin)}
                  icon={(
                    <IconBox shape="rounded-lg">
                      <img className="h-full w-full object-cover" src={plugin.icon} alt={title} />
                    </IconBox>
                  )}
                >
                  <div className="system-sm-medium truncate text-text-primary">{title}</div>
                  {!!description && (
                    <div className="system-xs-regular truncate text-text-tertiary">{description}</div>
                  )}
                  <ItemMeta
                    items={[
                      categoryNode,
                      t('marketplace.searchDropdown.byAuthor', { ns: 'plugin', author }),
                      installLabel,
                    ]}
                  />
                </DropdownItem>
              )
            })}
          </DropdownSection>
        )}

        {templates.length > 0 && (
          <DropdownSection title={t('templates', { ns: 'plugin' })}>
            {templates.map(template => (
              <DropdownItem
                key={template.template_id}
                href={getMarketplaceUrl(`/templates/${template.template_id}`)}
                icon={(
                  <IconBox shape="rounded-lg" className="text-base">
                    {template.icon || '📄'}
                  </IconBox>
                )}
              >
                <div className="system-sm-medium truncate text-text-primary">{template.name}</div>
                <ItemMeta
                  items={[
                    t('marketplace.searchDropdown.byAuthor', { ns: 'plugin', author: template.author }),
                    ...(template.tags.length > 0
                      ? [<span className="system-xs-regular truncate">{template.tags.join(', ')}</span>]
                      : []),
                  ]}
                />
              </DropdownItem>
            ))}
          </DropdownSection>
        )}

        {creators.length > 0 && (
          <DropdownSection title={t('marketplace.searchFilterCreators', { ns: 'plugin' })}>
            {creators.map(creator => (
              <DropdownItem
                key={creator.unique_handle}
                href={getMarketplaceUrl(`/creators/${creator.unique_handle}`)}
                icon={(
                  <IconBox shape="rounded-full">
                    <img
                      className="h-full w-full object-cover"
                      src={getCreatorAvatarUrl(creator.unique_handle)}
                      alt={creator.display_name}
                    />
                  </IconBox>
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="system-sm-medium truncate text-text-primary">{creator.display_name}</span>
                  <span className="system-xs-regular text-text-tertiary">
                    @
                    {creator.unique_handle}
                  </span>
                </div>
                {!!creator.description && (
                  <div className="system-xs-regular truncate text-text-tertiary">{creator.description}</div>
                )}
              </DropdownItem>
            ))}
          </DropdownSection>
        )}
      </div>
      <div className="border-t border-divider-subtle p-1">
        <button
          className="group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-state-base-hover"
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
            <RiArrowRightLine className="hidden h-[18px] w-[18px] text-text-accent group-hover:block" />
          </span>
        </button>
      </div>
    </div>
  )
}

export default SearchDropdown
