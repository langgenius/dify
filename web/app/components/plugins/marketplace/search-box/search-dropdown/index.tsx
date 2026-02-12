import type { Creator, Template } from '../../types'
import type { Plugin } from '@/app/components/plugins/types'
import { useTranslation } from '#i18n'
import { RiArrowRightLine } from '@remixicon/react'
import { Fragment } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import Loading from '@/app/components/base/loading'
import { useCategories } from '@/app/components/plugins/hooks'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { cn } from '@/utils/classnames'
import { formatUsedCount } from '@/utils/template'
import { getMarketplaceUrl } from '@/utils/var'
import { MARKETPLACE_TYPE_ICON_COMPONENTS } from '../../plugin-type-icons'
import { getCreatorAvatarUrl, getPluginDetailLinkInMarketplace, getTemplateIconUrl } from '../../utils'

const DROPDOWN_PANEL = 'w-[472px] max-h-[710px] overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl backdrop-blur-sm'
const ICON_BOX_BASE = 'flex shrink-0 items-center justify-center overflow-hidden border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge'

const SectionDivider = () => (
  <div className="border-t border-divider-subtle" />
)

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
  <a className="flex gap-1 rounded-lg py-1 pl-3 pr-1 hover:bg-state-base-hover" href={href}>
    {icon}
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-1">{children}</div>
  </a>
)

const IconBox = ({ shape, size = 'sm', className, style, children }: {
  shape: 'rounded-lg' | 'rounded-full'
  size?: 'sm' | 'md'
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) => (
  <div
    className={cn(
      ICON_BOX_BASE,
      shape,
      size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
      className,
    )}
    style={style}
  >
    {children}
  </div>
)

const ItemMeta = ({ items }: { items: (React.ReactNode | string)[] }) => (
  <div className="flex items-center gap-1.5 pt-1 text-text-tertiary">
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

  // Collect rendered sections with dividers between them
  const sections: React.ReactNode[] = []

  if (templates.length > 0) {
    sections.push(
      <TemplatesSection
        key="templates"
        templates={templates}
        t={t}
      />,
    )
  }

  if (plugins.length > 0) {
    sections.push(
      <PluginsSection
        key="plugins"
        plugins={plugins}
        getValueFromI18nObject={getValueFromI18nObject}
        categoriesMap={categoriesMap}
        t={t}
      />,
    )
  }

  if (creators.length > 0) {
    sections.push(
      <CreatorsSection
        key="creators"
        creators={creators}
        t={t}
      />,
    )
  }

  return (
    <div className={DROPDOWN_PANEL}>
      <div className="flex flex-col">
        {isLoading && !hasResults && (
          <div className="flex items-center justify-center py-6">
            <Loading />
          </div>
        )}

        {sections.map((section, i) => (
          <Fragment key={i}>
            {i > 0 && <SectionDivider />}
            {section}
          </Fragment>
        ))}
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

/* ---------- Templates Section ---------- */

function TemplatesSection({ templates, t }: {
  templates: Template[]
  t: ReturnType<typeof useTranslation>['t']
}) {
  return (
    <DropdownSection title={t('templates', { ns: 'plugin' })}>
      {templates.map((template) => {
        const descriptionText = template.overview
        const formattedUsedCount = formatUsedCount(template.usage_count, { precision: 0, rounding: 'floor' })
        const usedLabel = t('usedCount', { ns: 'plugin', num: formattedUsedCount || 0 })
        const iconUrl = getTemplateIconUrl(template)
        return (
          <DropdownItem
            key={template.id}
            href={getMarketplaceUrl(`/template/${template.publisher_handle}/${template.template_name}`, { templateId: template.id })}
            icon={(
              <div className="flex shrink-0 items-start py-1">
                <AppIcon
                  size="small"
                  iconType={iconUrl ? 'image' : 'emoji'}
                  icon={iconUrl ? undefined : (template.icon || '📄')}
                  imageUrl={iconUrl || undefined}
                  background={template.icon_background || undefined}
                />
              </div>
            )}
          >
            <div className="system-md-medium truncate text-text-primary">{template.template_name}</div>
            {!!descriptionText && (
              <div className="system-xs-regular line-clamp-2 text-text-tertiary">{descriptionText}</div>
            )}
            <ItemMeta
              items={[
                t('marketplace.searchDropdown.byAuthor', { ns: 'plugin', author: template.publisher_handle }),
                usedLabel,
              ]}
            />
          </DropdownItem>
        )
      })}
    </DropdownSection>
  )
}

/* ---------- Plugins Section ---------- */

function PluginsSection({ plugins, getValueFromI18nObject, categoriesMap, t }: {
  plugins: Plugin[]
  getValueFromI18nObject: ReturnType<typeof useRenderI18nObject>
  categoriesMap: Record<string, { label: string }>
  t: ReturnType<typeof useTranslation>['t']
}) {
  return (
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
            {TypeIcon && <TypeIcon className="h-[14px] w-[14px] text-text-tertiary" />}
            <span className="system-xs-regular">{categoryLabel}</span>
          </div>
        )
        return (
          <DropdownItem
            key={`${plugin.org}/${plugin.name}`}
            href={getPluginDetailLinkInMarketplace(plugin)}
            icon={(
              <div className="flex shrink-0 items-start py-1">
                <IconBox shape="rounded-lg">
                  <img className="h-full w-full object-cover" src={plugin.icon} alt={title} />
                </IconBox>
              </div>
            )}
          >
            <div className="system-md-medium truncate text-text-primary">{title}</div>
            {!!description && (
              <div className="system-xs-regular line-clamp-2 text-text-tertiary">{description}</div>
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
  )
}

/* ---------- Creators Section ---------- */

function CreatorsSection({ creators, t }: {
  creators: Creator[]
  t: ReturnType<typeof useTranslation>['t']
}) {
  return (
    <DropdownSection title={t('marketplace.searchFilterCreators', { ns: 'plugin' })}>
      {creators.map(creator => (
        <a
          key={creator.unique_handle}
          className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-state-base-hover"
          href={getMarketplaceUrl(`/creators/${creator.unique_handle}`)}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border-[0.5px] border-divider-regular">
            <img
              className="h-full w-full object-cover"
              src={getCreatorAvatarUrl(creator.unique_handle)}
              alt={creator.display_name}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <div className="system-md-medium truncate text-text-primary">{creator.display_name}</div>
            <div className="system-xs-regular truncate text-text-tertiary">
              @
              {creator.unique_handle}
            </div>
          </div>
        </a>
      ))}
    </DropdownSection>
  )
}

export default SearchDropdown
