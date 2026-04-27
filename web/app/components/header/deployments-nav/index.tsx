'use client'

import type { NavItem } from '../nav/nav-selector'
import type { AppIconType, AppModeEnum } from '@/types/app'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDeploymentsStore } from '@/app/components/deployments/store'
import { useSourceApps } from '@/app/components/deployments/use-source-apps'
import { useParams, useRouter, useSelectedLayoutSegment } from '@/next/navigation'
import Nav from '../nav'

const DeploymentsNav = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const selectedSegment = useSelectedLayoutSegment()
  const isActive = selectedSegment === 'deployments'
  const params = useParams<{ instanceId?: string }>()
  const instanceId = params?.instanceId

  const instances = useDeploymentsStore(state => state.instances)
  const openCreateInstanceModal = useDeploymentsStore(state => state.openCreateInstanceModal)

  const { appMap } = useSourceApps({ enabled: isActive })

  const navigationItems = useMemo<NavItem[]>(() => {
    if (!isActive)
      return []
    return instances.map((instance) => {
      const app = appMap.get(instance.appId)
      return {
        id: instance.id,
        name: instance.name,
        link: `/deployments/${instance.id}/overview`,
        icon_type: (app?.iconType ?? null) as AppIconType | null,
        icon: app?.icon ?? '',
        icon_background: app?.iconBackground ?? null,
        icon_url: app?.iconUrl ?? null,
        mode: app?.mode as unknown as AppModeEnum | undefined,
      }
    })
  }, [instances, appMap, isActive])

  const curNav = useMemo(() => {
    if (!instanceId)
      return undefined
    return navigationItems.find(item => item.id === instanceId)
  }, [instanceId, navigationItems])

  const handleCreate = useCallback(() => {
    openCreateInstanceModal()
    if (selectedSegment !== 'deployments' || instanceId)
      router.push('/deployments')
  }, [openCreateInstanceModal, router, selectedSegment, instanceId])

  return (
    <Nav
      isApp={false}
      icon={<span aria-hidden className="i-ri-rocket-line h-4 w-4" />}
      activeIcon={<span aria-hidden className="i-ri-rocket-fill h-4 w-4" />}
      text={t('menus.deployments', { ns: 'common' })}
      activeSegment="deployments"
      link="/deployments"
      curNav={curNav}
      navigationItems={navigationItems}
      createText={t('deployments:createModal.title')}
      onCreate={handleCreate}
    />
  )
}

export default DeploymentsNav
