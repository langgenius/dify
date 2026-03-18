import type {
  ModelProvider,
} from './declarations'
import type { Plugin } from '@/app/components/plugins/types'
import { useTheme } from 'next-themes'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import List from '@/app/components/plugins/marketplace/list'
import ProviderCard from '@/app/components/plugins/provider-card'
import Link from '@/next/link'
import { cn } from '@/utils/classnames'
import { getMarketplaceUrl } from '@/utils/var'
import {
  useMarketplaceAllPlugins,
} from './hooks'

type InstallFromMarketplaceProps = {
  providers: ModelProvider[]
  searchText: string
}
const InstallFromMarketplace = ({
  providers,
  searchText,
}: InstallFromMarketplaceProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [collapse, setCollapse] = useState(false)
  const {
    plugins: allPlugins,
    isLoading: isAllPluginsLoading,
  } = useMarketplaceAllPlugins(providers, searchText)

  const cardRender = useCallback((plugin: Plugin) => {
    if (plugin.type === 'bundle')
      return null

    return <ProviderCard key={plugin.plugin_id} payload={plugin} />
  }, [])

  return (
    <div className="mb-2">
      <Divider className="!mt-4 h-px" />
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left text-text-primary system-md-semibold"
          onClick={() => setCollapse(prev => !prev)}
          aria-expanded={!collapse}
        >
          <span className={cn('i-ri-arrow-down-s-line h-4 w-4', collapse && '-rotate-90')} />
          {t('modelProvider.installProvider', { ns: 'common' })}
        </button>
        <div className="mb-2 flex items-center pt-2">
          <span className="pr-1 text-text-tertiary system-sm-regular">{t('modelProvider.discoverMore', { ns: 'common' })}</span>
          <Link
            target="_blank"
            rel="noopener noreferrer"
            href={getMarketplaceUrl('', { theme })}
            className="inline-flex items-center text-text-accent system-sm-medium"
          >
            {t('marketplace.difyMarketplace', { ns: 'plugin' })}
            <span className="i-ri-arrow-right-up-line h-4 w-4" />
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
            showInstallButton
            cardContainerClassName="grid grid-cols-2 gap-2"
            cardRender={cardRender}
            emptyClassName="h-auto"
          />
        )
      }
    </div>
  )
}

export default InstallFromMarketplace
