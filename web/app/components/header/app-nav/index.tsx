'use client'

import type { NavItem } from '../nav/nav-selector'
import {
  RiRobot2Fill,
  RiRobot2Line,
} from '@remixicon/react'
import { flatten } from 'es-toolkit/compat'
import { produce } from 'immer'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreateAppTemplateDialog from '@/app/components/app/create-app-dialog'
import CreateAppModal from '@/app/components/app/create-app-modal'
import CreateFromDSLModal from '@/app/components/app/create-from-dsl-modal'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import { useInfiniteAppList } from '@/service/use-apps'
import { AppModeEnum } from '@/types/app'
import Nav from '../nav'

const AppNav = () => {
  const { t } = useTranslation()
  const { appId } = useParams()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const appDetail = useAppStore(state => state.appDetail)
  const [showNewAppDialog, setShowNewAppDialog] = useState(false)
  const [showNewAppTemplateDialog, setShowNewAppTemplateDialog] = useState(false)
  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(false)
  const [navItems, setNavItems] = useState<NavItem[]>([])

  const {
    data: appsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteAppList({
    page: 1,
    limit: 30,
    name: '',
  }, { enabled: !!appId })

  const handleLoadMore = useCallback(() => {
    if (hasNextPage)
      fetchNextPage()
  }, [fetchNextPage, hasNextPage])

  const openModal = (state: string) => {
    if (state === 'blank')
      setShowNewAppDialog(true)
    if (state === 'template')
      setShowNewAppTemplateDialog(true)
    if (state === 'dsl')
      setShowCreateFromDSLModal(true)
  }

  useEffect(() => {
    if (appsData) {
      const appItems = flatten((appsData.pages ?? []).map(appData => appData.data))
      const navItems = appItems.map((app) => {
        const link = ((isCurrentWorkspaceEditor, app) => {
          if (!isCurrentWorkspaceEditor) {
            return `/app/${app.id}/overview`
          }
          else {
            if (app.mode === AppModeEnum.WORKFLOW || app.mode === AppModeEnum.ADVANCED_CHAT)
              return `/app/${app.id}/workflow`
            else
              return `/app/${app.id}/configuration`
          }
        })(isCurrentWorkspaceEditor, app)
        return {
          id: app.id,
          icon_type: app.icon_type,
          icon: app.icon,
          icon_background: app.icon_background,
          icon_url: app.icon_url,
          name: app.name,
          mode: app.mode,
          link,
        }
      })
      setNavItems(navItems as any)
    }
  }, [appsData, isCurrentWorkspaceEditor, setNavItems])

  // update current app name
  useEffect(() => {
    if (appDetail) {
      const newNavItems = produce(navItems, (draft: NavItem[]) => {
        navItems.forEach((app, index) => {
          if (app.id === appDetail.id)
            draft[index].name = appDetail.name
        })
      })
      setNavItems(newNavItems)
    }
  }, [appDetail, navItems])

  return (
    <>
      <Nav
        isApp
        icon={<RiRobot2Line className="h-4 w-4" />}
        activeIcon={<RiRobot2Fill className="h-4 w-4" />}
        text={t('menus.apps', { ns: 'common' })}
        activeSegment={['apps', 'app']}
        link="/apps"
        curNav={appDetail}
        navigationItems={navItems}
        createText={t('menus.newApp', { ns: 'common' })}
        onCreate={openModal}
        onLoadMore={handleLoadMore}
        isLoadingMore={isFetchingNextPage}
      />
      <CreateAppModal
        show={showNewAppDialog}
        onClose={() => setShowNewAppDialog(false)}
        onSuccess={() => refetch()}
      />
      <CreateAppTemplateDialog
        show={showNewAppTemplateDialog}
        onClose={() => setShowNewAppTemplateDialog(false)}
        onSuccess={() => refetch()}
      />
      <CreateFromDSLModal
        show={showCreateFromDSLModal}
        onClose={() => setShowCreateFromDSLModal(false)}
        onSuccess={() => refetch()}
      />
    </>
  )
}

export default AppNav
