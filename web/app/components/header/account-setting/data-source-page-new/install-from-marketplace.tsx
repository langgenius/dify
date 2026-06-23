import type { DataSourceAuth } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiArrowDownSLine,
  RiArrowRightUpLine,
} from '@remixicon/react'
import { useTheme } from 'next-themes'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import List from '@/app/components/plugins/marketplace/list'
import { getMarketplaceCategoryUrl } from '@/app/components/plugins/marketplace/utils'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import ProviderCard from '@/app/components/plugins/provider-card'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import Link from '@/next/link'
import {
  useMarketplaceAllPlugins,
} from './hooks'

type InstallFromMarketplaceProps = {
  providers: DataSourceAuth[]
  searchText: string
}
const InstallFromMarketplace = ({
  providers,
  searchText,
}: InstallFromMarketplaceProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { canInstallPlugin } = usePluginSettingsAccess()
  const [collapse, setCollapse] = useState(false)
  const {
    plugins: allPlugins,
    isLoading: isAllPluginsLoading,
  } = useMarketplaceAllPlugins(providers, searchText)

  const cardRender = useCallback((plugin: Plugin) => {
    if (plugin.type === 'bundle')
      return null

    return <ProviderCard key={plugin.plugin_id} className="h-[146px]" payload={plugin} />
  }, [])

  return (
    <div className="mb-2">
      <Divider className="mt-4! h-px" />
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-expanded={!collapse}
          className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-left system-md-semibold text-text-primary"
          onClick={() => setCollapse(!collapse)}
        >
          <RiArrowDownSLine className={cn('size-4', collapse && '-rotate-90')} aria-hidden="true" />
          {t('modelProvider.installDataSource', { ns: 'common' })}
        </button>
        <div className="mb-2 flex items-center pt-2">
          <span className="pr-1 system-sm-regular text-text-tertiary">{t('modelProvider.discoverMore', { ns: 'common' })}</span>
          <Link target="_blank" href={getMarketplaceCategoryUrl(PluginCategoryEnum.datasource, { theme })} className="inline-flex items-center system-sm-medium text-text-accent">
            {t('marketplace.difyMarketplace', { ns: 'plugin' })}
            <RiArrowRightUpLine className="size-4" />
          </Link>
        </div>
      </div>
      {!collapse && isAllPluginsLoading && <Loading type="area" />}
      {
        !isAllPluginsLoading && !collapse && (
          <List
            marketplaceCollections={[]}
            marketplaceCollectionPluginsMap={{}}
            plugins={allPlugins}
            showInstallButton={canInstallPlugin}
            cardContainerClassName="grid grid-cols-3 gap-2"
            cardRender={cardRender}
            emptyClassName="h-auto"
          />
        )
      }
    </div>
  )
}

export default memo(InstallFromMarketplace)
