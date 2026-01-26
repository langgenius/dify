'use client'

import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { App } from '@/models/explore'
import { RiRobot2Line } from '@remixicon/react'
import { useDebounceFn } from 'ahooks'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppTypeSelector from '@/app/components/app/type-selector'
import { trackEvent } from '@/app/components/base/amplitude'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { DSLImportMode } from '@/models/app'
import { importDSL } from '@/service/apps'
import { fetchAppDetail } from '@/service/explore'
import { useExploreAppList } from '@/service/use-explore'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { cn } from '@/utils/classnames'
import AppCard from '../app-card'
import Sidebar, { AppCategories, AppCategoryLabel } from './sidebar'

type AppsProps = {
  onSuccess?: () => void
  onCreateFromBlank?: () => void
}

// export enum PageType {
//   EXPLORE = 'explore',
//   CREATE = 'create',
// }

const Apps = ({
  onSuccess,
  onCreateFromBlank,
}: AppsProps) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { push } = useRouter()
  const allCategoriesEn = AppCategories.RECOMMENDED

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })

  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const [currentType, setCurrentType] = useState<AppModeEnum[]>([])
  const [currCategory, setCurrCategory] = useState<AppCategories | string>(allCategoriesEn)

  const {
    data,
    isLoading,
  } = useExploreAppList()

  const filteredList = useMemo(() => {
    if (!data)
      return []
    const { allList } = data
    const filteredByCategory = allList.filter((item) => {
      if (currCategory === allCategoriesEn)
        return true
      return item.category === currCategory
    })
    if (currentType.length === 0)
      return filteredByCategory
    return filteredByCategory.filter((item) => {
      if (currentType.includes(AppModeEnum.CHAT) && item.app.mode === AppModeEnum.CHAT)
        return true
      if (currentType.includes(AppModeEnum.ADVANCED_CHAT) && item.app.mode === AppModeEnum.ADVANCED_CHAT)
        return true
      if (currentType.includes(AppModeEnum.AGENT_CHAT) && item.app.mode === AppModeEnum.AGENT_CHAT)
        return true
      if (currentType.includes(AppModeEnum.COMPLETION) && item.app.mode === AppModeEnum.COMPLETION)
        return true
      if (currentType.includes(AppModeEnum.WORKFLOW) && item.app.mode === AppModeEnum.WORKFLOW)
        return true
      return false
    })
  }, [currentType, currCategory, allCategoriesEn, data])

  const searchFilteredList = useMemo(() => {
    if (!searchKeywords || !filteredList || filteredList.length === 0)
      return filteredList

    const lowerCaseSearchKeywords = searchKeywords.toLowerCase()

    return filteredList.filter(item =>
      item.app && item.app.name && item.app.name.toLowerCase().includes(lowerCaseSearchKeywords),
    )
  }, [searchKeywords, filteredList])

  const [currApp, setCurrApp] = React.useState<App | null>(null)
  const [isShowCreateModal, setIsShowCreateModal] = React.useState(false)
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const onCreate: CreateAppModalProps['onConfirm'] = async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
  }) => {
    const { export_data, mode } = await fetchAppDetail(
      currApp?.app.id as string,
    )
    try {
      const app = await importDSL({
        mode: DSLImportMode.YAML_CONTENT,
        yaml_content: export_data,
        name,
        icon_type,
        icon,
        icon_background,
        description,
      })

      // Track app creation from template
      trackEvent('create_app_with_template', {
        app_mode: mode,
        template_id: currApp?.app.id,
        template_name: currApp?.app.name,
        description,
      })

      setIsShowCreateModal(false)
      Toast.notify({
        type: 'success',
        message: t('newApp.appCreated', { ns: 'app' }),
      })
      if (onSuccess)
        onSuccess()
      if (app.app_id)
        await handleCheckPluginDependencies(app.app_id)
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      getRedirection(isCurrentWorkspaceEditor, { id: app.app_id!, mode }, push)
    }
    catch {
      Toast.notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center">
        <Loading type="area" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-divider-burn py-3">
        <div className="min-w-[180px] pl-5">
          <span className="title-xl-semi-bold text-text-primary">{t('newApp.startFromTemplate', { ns: 'app' })}</span>
        </div>
        <div className="flex max-w-[548px] flex-1 items-center rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-1.5 shadow-md">
          <AppTypeSelector value={currentType} onChange={setCurrentType} />
          <div className="h-[14px]">
            <Divider type="vertical" />
          </div>
          <Input
            showClearIcon
            wrapperClassName="w-full flex-1"
            className="bg-transparent hover:border-transparent hover:bg-transparent focus:border-transparent focus:bg-transparent focus:shadow-none"
            placeholder={t('newAppFromTemplate.searchAllTemplate', { ns: 'app' }) as string}
            value={keywords}
            onChange={e => handleKeywordsChange(e.target.value)}
            onClear={() => handleKeywordsChange('')}
          />
        </div>
        <div className="h-8 w-[180px]"></div>
      </div>
      <div className="relative flex flex-1 overflow-y-auto">
        {!searchKeywords && (
          <div className="h-full w-[200px] p-4">
            <Sidebar current={currCategory as AppCategories} categories={data?.categories || []} onClick={(category) => { setCurrCategory(category) }} onCreateFromBlank={onCreateFromBlank} />
          </div>
        )}
        <div className="h-full flex-1 shrink-0 grow overflow-auto border-l border-divider-burn p-6 pt-2">
          {searchFilteredList && searchFilteredList.length > 0 && (
            <>
              <div className="pb-1 pt-4">
                {searchKeywords
                  ? <p className="title-md-semi-bold text-text-tertiary">{searchFilteredList.length > 1 ? t('newApp.foundResults', { ns: 'app', count: searchFilteredList.length }) : t('newApp.foundResult', { ns: 'app', count: searchFilteredList.length })}</p>
                  : (
                      <div className="flex h-[22px] items-center">
                        <AppCategoryLabel category={currCategory as AppCategories} className="title-md-semi-bold text-text-primary" />
                      </div>
                    )}
              </div>
              <div
                className={cn(
                  'grid shrink-0 grid-cols-1 content-start gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5 2k:grid-cols-6',
                )}
              >
                {searchFilteredList.map(app => (
                  <AppCard
                    key={app.app_id}
                    app={app}
                    canCreate={isCurrentWorkspaceEditor}
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
          appIconType={currApp?.app.icon_type || 'emoji'}
          appIcon={currApp?.app.icon || ''}
          appIconBackground={currApp?.app.icon_background || ''}
          appIconUrl={currApp?.app.icon_url}
          appName={currApp?.app.name || ''}
          appDescription={currApp?.app.description || ''}
          show={isShowCreateModal}
          onConfirm={onCreate}
          onHide={() => setIsShowCreateModal(false)}
        />
      )}
    </div>
  )
}

export default React.memo(Apps)

function NoTemplateFound() {
  const { t } = useTranslation()
  return (
    <div className="w-full rounded-lg bg-workflow-process-bg p-4">
      <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-components-card-bg shadow-lg">
        <RiRobot2Line className="h-5 w-5 text-text-tertiary" />
      </div>
      <p className="title-md-semi-bold text-text-primary">{t('newApp.noTemplateFound', { ns: 'app' })}</p>
      <p className="system-sm-regular text-text-tertiary">{t('newApp.noTemplateFoundTip', { ns: 'app' })}</p>
    </div>
  )
}
