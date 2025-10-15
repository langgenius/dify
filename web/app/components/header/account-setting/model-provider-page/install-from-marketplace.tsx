import { useCallback, useState } from 'react'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import {
  RiArrowDownSLine,
  RiArrowRightUpLine,
} from '@remixicon/react'
import type {
  ModelProvider,
} from './declarations'
import {
  useMarketplaceAllPlugins,
} from './hooks'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import ProviderCard from '@/app/components/plugins/provider-card'
import List from '@/app/components/plugins/marketplace/list'
import type { Plugin } from '@/app/components/plugins/types'
import cn from '@/utils/classnames'
import { getLocaleOnClient } from '@/i18n-config'
import { getMarketplaceUrl } from '@/utils/var'

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
  const locale = getLocaleOnClient()
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
    <div className='mb-2'>
      <Divider className='!mt-4 h-px' />
      <div className='flex items-center justify-between'>
        <div className='system-md-semibold flex cursor-pointer items-center gap-1 text-text-primary' onClick={() => setCollapse(!collapse)}>
          <RiArrowDownSLine className={cn('h-4 w-4', collapse && '-rotate-90')} />
          {t('common.modelProvider.installProvider')}
        </div>
        <div className='mb-2 flex items-center pt-2'>
          <span className='system-sm-regular pr-1 text-text-tertiary'>{t('common.modelProvider.discoverMore')}</span>
          <Link target="_blank" href={getMarketplaceUrl('', { theme })} className='system-sm-medium inline-flex items-center text-text-accent'>
            {t('plugin.marketplace.difyMarketplace')}
            <RiArrowRightUpLine className='h-4 w-4' />
          </Link>
        </div>
      </div>
      {!collapse && isAllPluginsLoading && <Loading type='area' />}
      {
        !isAllPluginsLoading && !collapse && (
          <List
            marketplaceCollections={[]}
            marketplaceCollectionPluginsMap={{}}
            plugins={allPlugins}
            showInstallButton
            locale={locale}
            cardContainerClassName='grid grid-cols-2 gap-2'
            cardRender={cardRender}
            emptyClassName='h-auto'
          />
        )
      }
    </div>
  )
}

export default InstallFromMarketplace
