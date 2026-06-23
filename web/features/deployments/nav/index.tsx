'use client'

import { useAtomValue } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import Nav from '@/app/components/header/nav'
import { useParams, useRouter, useSelectedLayoutSegment } from '@/next/navigation'
import {
  deploymentsNavActiveAtom,
  deploymentsNavAppInstanceIdAtom,
  deploymentsNavCurrentItemAtom,
  deploymentsNavItemsAtom,
  deploymentsNavListQueryAtom,
} from './state'

function DeploymentsNavContent() {
  const { t } = useTranslation()
  const router = useRouter()
  const navigationItems = useAtomValue(deploymentsNavItemsAtom)
  const curNav = useAtomValue(deploymentsNavCurrentItemAtom)
  const listQuery = useAtomValue(deploymentsNavListQueryAtom)

  function handleCreate() {
    router.push('/deployments/create')
  }

  function handleLoadMore() {
    if (listQuery.hasNextPage && !listQuery.isFetchingNextPage)
      void listQuery.fetchNextPage()
  }

  return (
    <Nav
      isApp={false}
      icon={<span aria-hidden className="i-ri-rocket-line size-4" />}
      activeIcon={<span aria-hidden className="i-ri-rocket-fill size-4" />}
      text={t('menus.deployments', { ns: 'common' })}
      activeSegment="deployments"
      link="/deployments"
      curNav={curNav}
      navigationItems={navigationItems}
      createText={t('deployments:list.createDeployment')}
      onCreate={handleCreate}
      onLoadMore={handleLoadMore}
      isLoadingMore={listQuery.isFetchingNextPage}
    />
  )
}

export function DeploymentsNav() {
  const selectedSegment = useSelectedLayoutSegment()
  const isActive = selectedSegment === 'deployments'
  const params = useParams<{ appInstanceId?: string }>()
  const appInstanceId = params?.appInstanceId

  return (
    <ScopeProvider
      key={`${isActive}:${appInstanceId ?? ''}`}
      atoms={[
        [deploymentsNavActiveAtom, isActive],
        [deploymentsNavAppInstanceIdAtom, appInstanceId],
      ]}
      name="DeploymentsNav"
    >
      <DeploymentsNavContent />
    </ScopeProvider>
  )
}
