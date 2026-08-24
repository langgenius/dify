'use client'

import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { StepByStepTourTaskId } from '@/app/components/step-by-step-tour/types'
import type { TrackCreateAppParams } from '@/utils/create-app-tracking'
import { cn } from '@langgenius/dify-ui/cn'
import { useQueryClient, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { useDebouncedValue } from 'foxact/use-debounced-value'
import { useAtomValue, useSetAtom } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getStepByStepTourPermissionVariant,
  trackStepByStepTourEvent,
} from '@/app/components/step-by-step-tour/analytics'
import {
  activeStepByStepTourGuideIndexAtom,
  activeStepByStepTourTaskIdAtom,
  advanceStepByStepTourGuideAtom,
  completedStepByStepTourTaskIdsAtom,
  completeStepByStepTourTaskAtom,
  resetStepByStepTourSessionAtom,
} from '@/app/components/step-by-step-tour/state'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { STEP_BY_STEP_TOUR_TASKS } from '@/app/components/step-by-step-tour/tasks'
import { useLocale } from '@/context/i18n'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useDocumentTitle from '@/hooks/use-document-title'
import { useImportDSL } from '@/hooks/use-import-dsl'
import { DSLImportMode } from '@/models/app'
import dynamic from '@/next/dynamic'
import { consoleQuery } from '@/service/client'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { hasPermission } from '@/utils/permission'
import { HomeBanner } from '../banner/home-banner'
import { HomeShell } from '../home-shell'
import { TemplateCard } from '../template-card'
import { HomeRecommendations } from './recommendations'
import s from './style.module.css'
import { HomeTemplatesHeader } from './templates-header'

const TryApp = dynamic(() => import('@/app/components/explore/try-app'), { ssr: false })
const CreateAppModal = dynamic(() => import('@/app/components/explore/create-app-modal'), {
  ssr: false,
})
const DSLConfirmModal = dynamic(
  () => import('@/app/components/app/create-from-dsl-modal/dsl-confirm-modal'),
  { ssr: false },
)

const HOME_STEP_BY_STEP_TOUR_TASK_ID = 'home' satisfies StepByStepTourTaskId

export function HomeContent() {
  const { t } = useTranslation()
  useDocumentTitle(t(($) => $['mainNav.home'], { ns: 'common' }))
  const locale = useLocale()
  const queryClient = useQueryClient()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const [templatesQuery, recentAppsQuery] = useSuspenseQueries({
    queries: [
      consoleQuery.explore.apps.get.queryOptions({
        input: { query: { language: locale } },
      }),
      consoleQuery.apps.recent.get.queryOptions({
        input: { query: { limit: 8 } },
      }),
    ],
  })
  const templatesData = templatesQuery.data
  const continueWorkApps = recentAppsQuery.data.data
  const allCategoriesEn = t(($) => $['apps.allCategories'], { ns: 'explore', lng: 'en' })
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const activeStepByStepTourTaskId = useAtomValue(activeStepByStepTourTaskIdAtom)
  const activeStepByStepTourGuideIndex = useAtomValue(activeStepByStepTourGuideIndexAtom)
  const completedStepByStepTourTaskIds = useAtomValue(completedStepByStepTourTaskIdsAtom)
  const advanceStepByStepTourGuide = useSetAtom(advanceStepByStepTourGuideAtom)
  const completeStepByStepTourTask = useSetAtom(completeStepByStepTourTaskAtom)
  const resetStepByStepTourSession = useSetAtom(resetStepByStepTourSessionAtom)
  const trackHomeTourCompleted = useCallback(
    (
      completedTaskIds: StepByStepTourTaskId[],
      homeOutcome: 'lesson_app_created' | 'lesson_opened',
    ) => {
      trackStepByStepTourEvent({
        action: 'task_completed',
        task_id: HOME_STEP_BY_STEP_TOUR_TASK_ID,
        completed_task_count: completedTaskIds.length,
        home_outcome: homeOutcome,
        permission_variant: getStepByStepTourPermissionVariant({
          canCreateApp,
          hasIntegrationWalkthroughPermissions: true,
          hasKnowledgeWalkthroughPermissions: true,
          taskId: HOME_STEP_BY_STEP_TOUR_TASK_ID,
        }),
        task_total: STEP_BY_STEP_TOUR_TASKS.length,
      })

      if (STEP_BY_STEP_TOUR_TASKS.every((task) => completedTaskIds.includes(task.id))) {
        trackStepByStepTourEvent({
          action: 'tour_completed',
          completed_task_count: completedTaskIds.length,
          task_total: STEP_BY_STEP_TOUR_TASKS.length,
        })
      }
    },
    [canCreateApp],
  )

  const [keywords, setKeywords] = useState('')
  const debouncedKeywords = useDebouncedValue(keywords, 500)
  const searchKeywords = keywords ? debouncedKeywords : ''

  const [currCategory, setCurrCategory] = useQueryState('category', {
    defaultValue: allCategoriesEn,
  })

  const visibleCategories = useMemo(() => {
    const categoriesWithApps = new Set<string>()
    templatesData.recommended_apps.forEach((app) => {
      app.categories?.forEach((category) => categoriesWithApps.add(category))
    })

    return templatesData.categories.filter((category) => categoriesWithApps.has(category))
  }, [templatesData])

  const activeCategory = visibleCategories.includes(currCategory) ? currCategory : allCategoriesEn

  const filteredList = useMemo(() => {
    return [...templatesData.recommended_apps]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .filter(
        (item) => activeCategory === allCategoriesEn || item.categories?.includes(activeCategory),
      )
  }, [templatesData, activeCategory, allCategoriesEn])

  const searchFilteredList = useMemo(() => {
    if (!searchKeywords || !filteredList || filteredList.length === 0) return filteredList

    const lowerCaseSearchKeywords = searchKeywords.toLowerCase()

    return filteredList.filter(
      (item) =>
        item.app && item.app.name && item.app.name.toLowerCase().includes(lowerCaseSearchKeywords),
    )
  }, [searchKeywords, filteredList])

  const [currApp, setCurrApp] = useState<RecommendedAppResponse | null>(null)
  const [isShowCreateModal, setIsShowCreateModal] = useState(false)

  const { handleImportDSL, handleImportDSLConfirm, versions, isFetching } = useImportDSL()
  const [showDSLConfirmModal, setShowDSLConfirmModal] = useState(false)

  const [currentTryApp, setCurrentTryApp] = useState<RecommendedAppResponse | undefined>(undefined)
  const currentCreateAppModeRef = useRef<string | null>(null)
  const currentCreateAppTrackingRef = useRef<Pick<
    TrackCreateAppParams,
    'source' | 'templateId'
  > | null>(null)
  const isCurrentTryAppFromLearnDifyRef = useRef(false)
  const shouldCompleteHomeTourOnCreateRef = useRef(false)
  const isSubmittingHomeTourCreateRef = useRef(false)
  const wasHomeTryAppCreateGuideActiveRef = useRef(false)
  const shouldForceShowLearnDifyForTour =
    activeStepByStepTourTaskId === HOME_STEP_BY_STEP_TOUR_TASK_ID &&
    !completedStepByStepTourTaskIds.includes(HOME_STEP_BY_STEP_TOUR_TASK_ID) &&
    (activeStepByStepTourGuideIndex ?? 0) === 0
  const abandonHomeTour = useCallback(() => {
    if (
      activeStepByStepTourTaskId !== HOME_STEP_BY_STEP_TOUR_TASK_ID ||
      completedStepByStepTourTaskIds.includes(HOME_STEP_BY_STEP_TOUR_TASK_ID)
    ) {
      return
    }

    resetStepByStepTourSession()
  }, [activeStepByStepTourTaskId, completedStepByStepTourTaskIds, resetStepByStepTourSession])

  const completeHomeTourAfterCreate = useCallback(() => {
    if (!shouldCompleteHomeTourOnCreateRef.current) return

    resetStepByStepTourSession()
    isCurrentTryAppFromLearnDifyRef.current = false
    shouldCompleteHomeTourOnCreateRef.current = false
    isSubmittingHomeTourCreateRef.current = false
    completeStepByStepTourTask({
      taskId: HOME_STEP_BY_STEP_TOUR_TASK_ID,
      onSuccess: (completedTaskIds) => {
        trackHomeTourCompleted(completedTaskIds, 'lesson_app_created')
      },
    })
  }, [completeStepByStepTourTask, resetStepByStepTourSession, trackHomeTourCompleted])

  const completeHomeTourAfterOpenDetails = useCallback(() => {
    if (
      activeStepByStepTourTaskId !== HOME_STEP_BY_STEP_TOUR_TASK_ID ||
      completedStepByStepTourTaskIds.includes(HOME_STEP_BY_STEP_TOUR_TASK_ID) ||
      (activeStepByStepTourGuideIndex ?? 0) !== 0
    ) {
      return
    }

    resetStepByStepTourSession()
    completeStepByStepTourTask({
      taskId: HOME_STEP_BY_STEP_TOUR_TASK_ID,
      onSuccess: (completedTaskIds) => trackHomeTourCompleted(completedTaskIds, 'lesson_opened'),
    })
  }, [
    activeStepByStepTourGuideIndex,
    activeStepByStepTourTaskId,
    completedStepByStepTourTaskIds,
    completeStepByStepTourTask,
    resetStepByStepTourSession,
    trackHomeTourCompleted,
  ])

  const abandonHomeTourCreate = useCallback(() => {
    if (!isCurrentTryAppFromLearnDifyRef.current || isSubmittingHomeTourCreateRef.current) return

    abandonHomeTour()
    setCurrentTryApp(undefined)
    setCurrApp(null)
    currentCreateAppTrackingRef.current = null
    currentCreateAppModeRef.current = null
    isCurrentTryAppFromLearnDifyRef.current = false
    shouldCompleteHomeTourOnCreateRef.current = false
  }, [abandonHomeTour])

  const hideTryAppPanel = useCallback(() => {
    abandonHomeTourCreate()
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Also called from the tour-state sync effect when the Learn Dify action guide is skipped.
    setCurrentTryApp(undefined)
  }, [abandonHomeTourCreate])
  const homeTryAppCreateGuideActive =
    activeStepByStepTourTaskId === HOME_STEP_BY_STEP_TOUR_TASK_ID &&
    activeStepByStepTourGuideIndex === 1 &&
    !completedStepByStepTourTaskIds.includes(HOME_STEP_BY_STEP_TOUR_TASK_ID)
  useEffect(() => {
    if (!isCurrentTryAppFromLearnDifyRef.current || !currentTryApp || isShowCreateModal) {
      wasHomeTryAppCreateGuideActiveRef.current = false
      return
    }

    if (homeTryAppCreateGuideActive) {
      wasHomeTryAppCreateGuideActiveRef.current = true
      return
    }

    if (wasHomeTryAppCreateGuideActiveRef.current) {
      wasHomeTryAppCreateGuideActiveRef.current = false
      hideTryAppPanel()
    }
  }, [currentTryApp, hideTryAppPanel, homeTryAppCreateGuideActive, isShowCreateModal])
  const handleTryApp = useCallback((app: RecommendedAppResponse) => {
    isCurrentTryAppFromLearnDifyRef.current = false
    setCurrentTryApp(app)
  }, [])
  const handleTryAppFromLearnDify = useCallback(
    (app: RecommendedAppResponse) => {
      isCurrentTryAppFromLearnDifyRef.current = true
      setCurrentTryApp(app)

      if (
        activeStepByStepTourTaskId === HOME_STEP_BY_STEP_TOUR_TASK_ID &&
        !completedStepByStepTourTaskIds.includes(HOME_STEP_BY_STEP_TOUR_TASK_ID) &&
        (activeStepByStepTourGuideIndex ?? 0) === 0
      ) {
        if (!canCreateApp) {
          completeHomeTourAfterOpenDetails()
          isCurrentTryAppFromLearnDifyRef.current = false
          return
        }

        advanceStepByStepTourGuide({
          guideIndex: 1,
        })
      }
    },
    [
      activeStepByStepTourGuideIndex,
      activeStepByStepTourTaskId,
      advanceStepByStepTourGuide,
      canCreateApp,
      completedStepByStepTourTaskIds,
      completeHomeTourAfterOpenDetails,
    ],
  )
  const handleShowFromTryApp = useCallback(() => {
    setCurrApp(currentTryApp || null)
    currentCreateAppTrackingRef.current = {
      source: 'explore_template_preview',
      templateId: currentTryApp?.app_id,
    }
    shouldCompleteHomeTourOnCreateRef.current =
      isCurrentTryAppFromLearnDifyRef.current &&
      activeStepByStepTourTaskId === HOME_STEP_BY_STEP_TOUR_TASK_ID &&
      !completedStepByStepTourTaskIds.includes(HOME_STEP_BY_STEP_TOUR_TASK_ID) &&
      activeStepByStepTourGuideIndex === 1
    setIsShowCreateModal(true)
  }, [
    activeStepByStepTourGuideIndex,
    activeStepByStepTourTaskId,
    completedStepByStepTourTaskIds,
    currentTryApp,
  ])
  const handleCreateFromLearnDify = useCallback((app: RecommendedAppResponse) => {
    setCurrApp(app)
    setIsShowCreateModal(true)
  }, [])
  const handleCreateFromTemplate = useCallback((app: RecommendedAppResponse) => {
    currentCreateAppTrackingRef.current = {
      source: 'explore_template_list',
      templateId: app.app_id,
    }
    setCurrApp(app)
    setIsShowCreateModal(true)
  }, [])
  const trackCurrentCreateApp = useCallback((appMode?: string | null) => {
    const currentCreateAppTracking = currentCreateAppTrackingRef.current
    const resolvedAppMode = appMode ?? currentCreateAppModeRef.current
    if (!resolvedAppMode || !currentCreateAppTracking) return

    trackCreateApp({
      ...currentCreateAppTracking,
      appMode: resolvedAppMode,
    })
    currentCreateAppTrackingRef.current = null
    currentCreateAppModeRef.current = null
  }, [])
  const handleCreateModalHide = useCallback(() => {
    if (!isSubmittingHomeTourCreateRef.current) abandonHomeTourCreate()

    setIsShowCreateModal(false)
  }, [abandonHomeTourCreate])

  const onCreate: CreateAppModalProps['onConfirm'] = useCallback(
    async ({ name, icon_type, icon, icon_background, description }) => {
      isSubmittingHomeTourCreateRef.current = shouldCompleteHomeTourOnCreateRef.current
      hideTryAppPanel()

      const appId = currApp?.app_id
      if (!appId) return

      const appDetail = await queryClient.ensureQueryData(
        consoleQuery.explore.apps.byAppId.get.queryOptions({
          input: { params: { app_id: appId } },
        }),
      )

      const { export_data, mode } = appDetail
      currentCreateAppModeRef.current = mode
      const payload = {
        mode: DSLImportMode.YAML_CONTENT,
        yaml_content: export_data,
        name,
        icon_type,
        icon,
        icon_background,
        description,
      }
      let didTransitionCreateFlow = false
      await handleImportDSL(payload, {
        onSuccess: (response) => {
          didTransitionCreateFlow = true
          trackCurrentCreateApp(response.app_mode)
          completeHomeTourAfterCreate()
          setIsShowCreateModal(false)
        },
        onPending: () => {
          didTransitionCreateFlow = true
          setShowDSLConfirmModal(true)
        },
        skipRedirectOnSuccess: shouldCompleteHomeTourOnCreateRef.current,
      })
      if (!didTransitionCreateFlow && shouldCompleteHomeTourOnCreateRef.current) {
        isSubmittingHomeTourCreateRef.current = false
        abandonHomeTourCreate()
      }
    },
    [
      abandonHomeTourCreate,
      completeHomeTourAfterCreate,
      currApp?.app_id,
      handleImportDSL,
      hideTryAppPanel,
      queryClient,
      trackCurrentCreateApp,
    ],
  )

  const onConfirmDSL = useCallback(async () => {
    await handleImportDSLConfirm({
      onSuccess: (response) => {
        trackCurrentCreateApp(response.app_mode)
        completeHomeTourAfterCreate()
      },
      skipRedirectOnSuccess: shouldCompleteHomeTourOnCreateRef.current,
    })
  }, [completeHomeTourAfterCreate, handleImportDSLConfirm, trackCurrentCreateApp])

  const handleCancelDSLConfirm = useCallback(() => {
    setShowDSLConfirmModal(false)
    isSubmittingHomeTourCreateRef.current = false
    abandonHomeTourCreate()
  }, [abandonHomeTourCreate])

  return (
    <HomeShell>
      <div className="flex flex-1 flex-col overflow-y-auto">
        {systemFeatures.enable_explore_banner && <HomeBanner />}
        <HomeRecommendations
          canCreate={canCreateApp}
          continueWorkApps={continueWorkApps}
          forceShowLearnDify={shouldForceShowLearnDifyForTour}
          onCreate={handleCreateFromLearnDify}
          onTry={handleTryAppFromLearnDify}
        />

        <HomeTemplatesHeader
          allCategoriesEn={allCategoriesEn}
          categories={visibleCategories}
          currCategory={activeCategory}
          keywords={keywords}
          onCategoryChange={setCurrCategory}
          onKeywordsChange={setKeywords}
        />

        <div className={cn('relative flex flex-1 shrink-0 grow flex-col pb-6')}>
          <nav
            aria-labelledby="home-templates-title"
            className={cn(s.templateGrid, 'grid shrink-0 content-start gap-3 px-8')}
          >
            {searchFilteredList.map((app) => (
              <TemplateCard
                key={app.app_id}
                app={app}
                canCreate={canCreateApp}
                onCreate={() => handleCreateFromTemplate(app)}
                onTry={handleTryApp}
              />
            ))}
          </nav>
        </div>
      </div>
      {isShowCreateModal && (
        <CreateAppModal
          appIconType={
            currApp?.app?.icon_type === 'image' ||
            currApp?.app?.icon_type === 'emoji' ||
            currApp?.app?.icon_type === 'link'
              ? currApp.app.icon_type
              : 'emoji'
          }
          appIcon={currApp?.app?.icon || ''}
          appIconBackground={currApp?.app?.icon_background || ''}
          appIconUrl={currApp?.app?.icon_url}
          appName={currApp?.app?.name || ''}
          appDescription={currApp?.description || ''}
          show={isShowCreateModal}
          onConfirm={onCreate}
          confirmDisabled={isFetching}
          onHide={handleCreateModalHide}
        />
      )}
      {showDSLConfirmModal && (
        <DSLConfirmModal
          versions={versions}
          onCancel={handleCancelDSLConfirm}
          onConfirm={onConfirmDSL}
          confirmDisabled={isFetching}
        />
      )}

      {currentTryApp && (
        <TryApp
          appId={currentTryApp.app_id}
          app={currentTryApp}
          canCreate={canCreateApp}
          categories={currentTryApp.categories ?? []}
          createButtonStepByStepTourTarget={
            canCreateApp && isCurrentTryAppFromLearnDifyRef.current && !isShowCreateModal
              ? STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate
              : undefined
          }
          onClose={hideTryAppPanel}
          onCreate={handleShowFromTryApp}
        />
      )}
    </HomeShell>
  )
}
