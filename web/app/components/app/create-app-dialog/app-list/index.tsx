'use client'

import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Separator } from '@langgenius/dify-ui/separator'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebouncedValue } from 'foxact/use-debounced-value'
import { useAtomValue } from 'jotai'
import dynamic from 'next/dynamic'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import DSLConfirmModal from '@/app/components/app/create-from-dsl-modal/dsl-confirm-modal'
import AppTypeSelector from '@/app/components/app/type-selector'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import { getTemplateImportSource } from '@/app/components/explore/template-import'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useCanImportAgents } from '@/features/agent-v2/permissions'
import { useImportDSL } from '@/hooks/use-import-dsl'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { hasPermission } from '@/utils/permission'
import AppCard from '../app-card'
import Sidebar, { AppCategories, AppCategoryLabel } from './sidebar'

const TryApp = dynamic(() => import('@/app/components/explore/try-app'), { ssr: false })

type AppsProps = {
  onClose: () => void
  onCreateFromBlank?: () => void
  templateMode?: 'agent'
}

const Apps = ({ onClose, onCreateFromBlank, templateMode }: AppsProps) => {
  const { t } = useTranslation(['app', 'common'])
  const locale = useLocale()
  const queryClient = useQueryClient()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canImportAgents = useCanImportAgents()
  const canCreateAppFromTemplate = hasPermission(
    workspacePermissionKeys,
    'app.create_and_management',
  )
  const canCreateTemplate = (mode?: string | null) =>
    mode === 'agent' ? canImportAgents : canCreateAppFromTemplate
  const { handleImportDSL, handleImportDSLConfirm, versions, isFetching } = useImportDSL()
  const allCategoriesEn = AppCategories.RECOMMENDED

  const [keywords, setKeywords] = useState('')
  const debouncedKeywords = useDebouncedValue(keywords, 500)
  const searchKeywords = keywords ? debouncedKeywords : ''
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const handleClearSearch = () => {
    setKeywords('')
    searchInputRef.current?.focus()
  }

  const [currentType, setCurrentType] = useState<AppModeEnum[]>([])
  const [currCategory, setCurrCategory] = useState<AppCategories | string>(allCategoriesEn)

  const { data, isLoading } = useQuery(
    consoleQuery.explore.apps.get.queryOptions({
      input: { query: { language: locale } },
    }),
  )
  const allList = useMemo(
    () =>
      [...(data?.recommended_apps ?? [])]
        .filter((item) =>
          templateMode ? item.app?.mode === templateMode : item.app?.mode !== AppModeEnum.AGENT,
        )
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [data?.recommended_apps, templateMode],
  )

  const visibleCategories = useMemo(() => {
    if (!data) return []

    const categoriesWithApps = new Set<string>()
    allList.forEach((app) => {
      app.categories?.forEach((category) => categoriesWithApps.add(category))
    })

    return data.categories.filter((category) => categoriesWithApps.has(category))
  }, [data, allList])

  const activeCategory = visibleCategories.includes(currCategory) ? currCategory : allCategoriesEn

  const filteredList = useMemo(() => {
    if (!data) return []
    const filteredByCategory = allList.filter((item) => {
      if (activeCategory === allCategoriesEn) return true
      return item.categories?.includes(activeCategory) ?? false
    })
    if (currentType.length === 0) return filteredByCategory
    return filteredByCategory.filter((item) => {
      if (currentType.includes(AppModeEnum.CHAT) && item.app?.mode === AppModeEnum.CHAT) return true
      if (
        currentType.includes(AppModeEnum.ADVANCED_CHAT) &&
        item.app?.mode === AppModeEnum.ADVANCED_CHAT
      )
        return true
      if (currentType.includes(AppModeEnum.AGENT_CHAT) && item.app?.mode === AppModeEnum.AGENT_CHAT)
        return true
      if (currentType.includes(AppModeEnum.COMPLETION) && item.app?.mode === AppModeEnum.COMPLETION)
        return true
      if (currentType.includes(AppModeEnum.WORKFLOW) && item.app?.mode === AppModeEnum.WORKFLOW)
        return true
      return false
    })
  }, [currentType, activeCategory, allCategoriesEn, data, allList])

  const searchFilteredList = useMemo(() => {
    if (!searchKeywords || !filteredList || filteredList.length === 0) return filteredList

    const lowerCaseSearchKeywords = searchKeywords.toLowerCase()

    return filteredList.filter(
      (item) =>
        item.app &&
        [item.app.name, item.description].some((value) =>
          value?.toLowerCase().includes(lowerCaseSearchKeywords),
        ),
    )
  }, [searchKeywords, filteredList])

  const [currApp, setCurrApp] = React.useState<RecommendedAppResponse | null>(null)
  const [previewApp, setPreviewApp] = React.useState<RecommendedAppResponse | null>(null)
  const [isShowCreateModal, setIsShowCreateModal] = React.useState(false)
  const [showDSLConfirmModal, setShowDSLConfirmModal] = React.useState(false)
  const onCreate: CreateAppModalProps['onConfirm'] = async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
  }) => {
    if (!currApp || !canCreateTemplate(currApp.app?.mode)) return
    try {
      const detail = await queryClient.query({
        ...consoleQuery.explore.apps.byAppId.get.queryOptions({
          input: { params: { app_id: currApp.app_id } },
        }),
        staleTime: 0,
      })
      if (
        !canCreateTemplate(detail.mode) ||
        (templateMode ? detail.mode !== templateMode : detail.mode === AppModeEnum.AGENT)
      )
        throw new Error('Template mode does not match this picker')
      await handleImportDSL(
        {
          ...getTemplateImportSource(detail),
          name,
          icon_type,
          icon,
          icon_background,
          description,
        },
        {
          onSuccess: (response) => {
            if (response.app_mode) {
              trackCreateApp({
                source: 'studio_template_list',
                appMode: response.app_mode,
                templateId: currApp.app_id,
              })
            }
            setIsShowCreateModal(false)
            onClose()
          },
          onPending: () => setShowDSLConfirmModal(true),
        },
      )
    } catch {
      toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
    }
  }
  const onConfirmDSL = async () => {
    await handleImportDSLConfirm({
      onSuccess: (response) => {
        if (response.app_mode) {
          trackCreateApp({
            source: 'studio_template_list',
            appMode: response.app_mode,
            templateId: currApp?.app_id,
          })
        }
        setShowDSLConfirmModal(false)
        setIsShowCreateModal(false)
        onClose()
      },
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center">
        <LoadingPlaceholder />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-divider-burn py-3">
        <div className="min-w-45 pl-5">
          <span className="title-xl-semi-bold text-text-primary">
            {t(($) => $['newApp.startFromTemplate'], { ns: 'app' })}
          </span>
        </div>
        <div className="flex max-w-137 flex-1 items-center rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-1.5 shadow-md">
          {!templateMode && (
            <>
              <AppTypeSelector value={currentType} onChange={setCurrentType} />
              <div className="h-3.5">
                <Separator decorative className="mx-2" orientation="vertical" />
              </div>
            </>
          )}
          <InputGroup className="flex-1 bg-transparent hover:border-transparent hover:bg-transparent">
            <InputGroupInput
              ref={searchInputRef}
              type="search"
              name="query"
              autoComplete="off"
              enterKeyHint="search"
              aria-label={t(($) => $['newAppFromTemplate.searchAllTemplate'], { ns: 'app' })}
              className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
              placeholder={t(($) => $['newAppFromTemplate.searchAllTemplate'], { ns: 'app' })}
              value={keywords}
              onValueChange={setKeywords}
            />
            {keywords && (
              <InputGroupAddon align="inline-end" className="ps-0.75 pe-1.25">
                <IconButton
                  size="sm"
                  aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
                  className="text-text-quaternary hover:bg-transparent hover:text-text-tertiary focus-visible:bg-components-input-bg-hover focus-visible:ring-inset"
                  onClick={handleClearSearch}
                >
                  <span aria-hidden className="i-ri-close-circle-fill size-3.5" />
                </IconButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        <div className="h-8 w-45"></div>
      </div>
      <div className="relative flex flex-1 overflow-y-auto">
        {!searchKeywords && (
          <div className="h-full w-50 p-4">
            <Sidebar
              current={activeCategory}
              categories={visibleCategories}
              onClick={(category) => {
                setCurrCategory(category)
              }}
              onCreateFromBlank={onCreateFromBlank}
            />
          </div>
        )}
        <div className="h-full flex-1 shrink-0 grow overflow-auto border-l border-divider-burn p-6 pt-2">
          {searchFilteredList && searchFilteredList.length > 0 && (
            <>
              <div className="pt-4 pb-1">
                {searchKeywords ? (
                  <p className="title-md-semi-bold text-text-tertiary">
                    {searchFilteredList.length > 1
                      ? t(($) => $['newApp.foundResults'], {
                          ns: 'app',
                          count: searchFilteredList.length,
                        })
                      : t(($) => $['newApp.foundResult'], {
                          ns: 'app',
                          count: searchFilteredList.length,
                        })}
                  </p>
                ) : (
                  <div className="flex h-5.5 items-center">
                    <AppCategoryLabel
                      category={activeCategory}
                      className="title-md-semi-bold text-text-primary"
                    />
                  </div>
                )}
              </div>
              <div
                className={cn(
                  'grid shrink-0 grid-cols-[repeat(auto-fill,minmax(296px,1fr))] content-start gap-3',
                )}
              >
                {searchFilteredList.map((app) => (
                  <AppCard
                    key={app.app_id}
                    app={app}
                    canCreate={canCreateTemplate(app.app?.mode)}
                    onPreview={() => setPreviewApp(app)}
                    onCreate={() => {
                      setCurrApp(app)
                      setIsShowCreateModal(true)
                    }}
                  />
                ))}
              </div>
            </>
          )}
          {(!searchFilteredList || searchFilteredList.length === 0) && <NoTemplateFound />}
        </div>
      </div>
      {isShowCreateModal && (
        <CreateAppModal
          appIconType={
            currApp?.app?.icon_type === 'image' || currApp?.app?.icon_type === 'link'
              ? currApp.app.icon_type
              : 'emoji'
          }
          appIcon={currApp?.app?.icon ?? ''}
          appIconBackground={currApp?.app?.icon_background ?? ''}
          appIconUrl={currApp?.app?.icon_url}
          appName={currApp?.app?.name ?? ''}
          appDescription=""
          show={isShowCreateModal}
          onConfirm={onCreate}
          confirmLoading={isFetching}
          onHide={() => setIsShowCreateModal(false)}
        />
      )}
      {showDSLConfirmModal && (
        <DSLConfirmModal
          versions={versions}
          onCancel={() => setShowDSLConfirmModal(false)}
          onConfirm={onConfirmDSL}
          confirmLoading={isFetching}
        />
      )}
      {previewApp && (
        <TryApp
          appId={previewApp.app_id}
          canTrial={previewApp.can_trial}
          categories={previewApp.categories}
          templateName={previewApp.app?.name}
          templateMode={previewApp.app?.mode}
          canCreate={canCreateTemplate(previewApp.app?.mode)}
          onClose={() => setPreviewApp(null)}
          onCreate={() => {
            setCurrApp(previewApp)
            setPreviewApp(null)
            setIsShowCreateModal(true)
          }}
        />
      )}
    </div>
  )
}

export default React.memo(Apps)

function NoTemplateFound() {
  const { t } = useTranslation(['app'])
  return (
    <div className="w-full rounded-lg bg-workflow-process-bg p-4">
      <div className="mb-2 inline-flex size-8 items-center justify-center rounded-lg bg-components-card-bg shadow-lg">
        <span aria-hidden className="i-ri-robot-2-line size-5 text-text-tertiary" />
      </div>
      <p className="title-md-semi-bold text-text-primary">
        {t(($) => $['newApp.noTemplateFound'], { ns: 'app' })}
      </p>
      <p className="system-sm-regular text-text-tertiary">
        {t(($) => $['newApp.noTemplateFoundTip'], { ns: 'app' })}
      </p>
    </div>
  )
}
