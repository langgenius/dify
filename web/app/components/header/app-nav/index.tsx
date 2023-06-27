import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, usePathname, useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation'
import useSWRInfinite from 'swr/infinite'
import { flatten } from 'lodash-es'
import Nav from '../nav'
import { fetchAppList } from '@/service/apps'
import NewAppDialog from '@/app/(commonLayout)/apps/NewAppDialog'
import { Container } from '@/app/components/base/icons/src/vender/line/development'
import type { AppListResponse } from '@/models/app'

const getKey = (pageIndex: number, previousPageData: AppListResponse) => {
  if (!pageIndex || previousPageData.has_more)
    return { url: 'apps', params: { page: pageIndex + 1, limit: 30 } }
  return null
}

const AppNav = () => {
  const { t } = useTranslation()
  const [showNewAppDialog, setShowNewAppDialog] = useState(false)
  const { data: appsData, isLoading, setSize } = useSWRInfinite(false ? getKey : () => null, fetchAppList, { revalidateFirstPage: false })
  // const { datasets, currentDataset } = useDatasetsContext()
  // const router = useRouter()
  // const showEnvTag = langeniusVersionInfo.current_env === 'TESTING' || langeniusVersionInfo.current_env === 'DEVELOPMENT'
  const selectedSegment = useSelectedLayoutSegment()
  console.log(selectedSegment)
  console.log(usePathname(), useSearchParams(), useRouter(), useParams())
  // const isPluginsComingSoon = selectedSegment === 'plugins-coming-soon'
  // const isExplore = selectedSegment === 'explore'
  // const [starCount, setStarCount] = useState(0)

  const appItems = flatten(appsData?.map(appData => appData.data))

  const handleLoadmore = useCallback(() => {
    if (isLoading)
      return

    setSize(size => size + 1)
  }, [setSize, isLoading])

  return (
    <>
      <Nav
        icon={<Container />}
        text={t('common.menus.apps')}
        activeSegment={['apps', 'app']}
        link='/apps'
        curNav={appItems.find(appItem => appItem.id === '')}
        navs={appItems.map(item => ({
          id: item.id,
          name: item.name,
          link: `/app/${item.id}/overview`,
          icon: item.icon,
          icon_background: item.icon_background,
        }))}
        createText={t('common.menus.newApp')}
        onCreate={() => setShowNewAppDialog(true)}
        onLoadmore={handleLoadmore}
      />
      <NewAppDialog show={showNewAppDialog} onClose={() => setShowNewAppDialog(false)} />
    </>
  )
}

export default AppNav
