'use client'
import type { FC } from 'react'
import type { Collection, Tool } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { RiArrowLeftLine, RiCloseLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import Icon from '@/app/components/plugins/card/base/card-icon'
import Description from '@/app/components/plugins/card/base/description'
import OrgInfo from '@/app/components/plugins/card/base/org-info'
import { AuthCategory, PluginAuthInAgent } from '@/app/components/plugins/plugin-auth'
import { ReadmeEntrance } from '@/app/components/plugins/readme-panel/entrance'
import { CollectionType } from '@/app/components/tools/types'
import { selectBuiltinProviderTools } from '@/app/components/tools/utils/query-select'
import {
  addDefaultValue,
  toolParametersToFormSchemas,
} from '@/app/components/tools/utils/to-form-schema'
import { getPluginLanguage } from '@/i18n/metadata'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

type Props = Readonly<{
  showBackButton?: boolean
  collection: Collection | ToolWithProvider
  isBuiltIn?: boolean
  toolName: string
  setting?: Record<string, any>
  readonly?: boolean
  showReadOnlySettingDetails?: boolean
  onHide: () => void
  onSave?: (value: Record<string, any>) => void
  credentialId?: string
  onAuthorizationItemClick?: (id: string) => void
}>

const SettingBuiltInTool: FC<Props> = ({
  showBackButton = false,
  collection,
  isBuiltIn = true,
  toolName,
  setting = {},
  readonly,
  showReadOnlySettingDetails = false,
  onHide,
  onSave,
  credentialId,
  onAuthorizationItemClick,
}) => {
  const locale = useLocale()
  const language = getPluginLanguage(locale)
  const { t } = useTranslation(['common', 'plugin', 'tools'])
  const passedTools = (collection as ToolWithProvider).tools
  const hasPassedTools = passedTools?.length > 0
  const toolSource =
    !collection || hasPassedTools
      ? undefined
      : isBuiltIn
        ? 'builtin'
        : collection.type === CollectionType.workflow
          ? 'workflow'
          : 'api'
  const toolProvider = consoleQuery.workspaces.current.toolProvider
  // A failed load is shown in the drawer with a retry, so requests are not retried automatically.
  const builtInTools = useQuery(
    toolProvider.builtin.byProvider.tools.get.queryOptions({
      input: { params: { provider: collection?.name } },
      enabled: toolSource === 'builtin',
      select: selectBuiltinProviderTools,
      retry: false,
    }),
  )
  const workflowTools = useQuery(
    toolProvider.workflow.tools.get.queryOptions({
      input: { query: { workflow_tool_id: collection?.id } },
      enabled: toolSource === 'workflow',
      select: selectBuiltinProviderTools,
      retry: false,
    }),
  )
  const customTools = useQuery(
    toolProvider.api.tools.get.queryOptions({
      input: { query: { provider: collection?.name } },
      enabled: toolSource === 'api',
      select: selectBuiltinProviderTools,
      retry: false,
    }),
  )
  const fetchedTools =
    toolSource === 'builtin'
      ? builtInTools
      : toolSource === 'workflow'
        ? workflowTools
        : customTools
  const isLoading = !!toolSource && fetchedTools.isPending
  const toolsLoad = useOwnedQueryErrors(toolSource ? [fetchedTools] : [])
  const toolsLoadErrorMessage = useRequestErrorMessage(
    toolsLoad?.error,
    t(($) => $['api.actionFailed'], { ns: 'common' }),
  )
  const tools: Tool[] = hasPassedTools ? passedTools : toolSource ? (fetchedTools.data ?? []) : []
  const currTool = tools.find((tool) => tool.name === toolName)
  const formSchemas = currTool ? toolParametersToFormSchemas(currTool.parameters) : []
  const infoSchemas = formSchemas.filter((item) => item.form === 'llm')
  const settingSchemas = formSchemas
    .filter((item) => item.form !== 'llm')
    .map((item) =>
      item.type === FormTypeEnum.select
        ? {
            ...item,
            placeholder: item.placeholder ?? {
              en_US: t(($) => $['placeholder.select'], { ns: 'common' }),
              zh_Hans: t(($) => $['placeholder.select'], { ns: 'common' }),
              [language]: t(($) => $['placeholder.select'], { ns: 'common' }),
            },
          }
        : item,
    )
  const hasSetting = settingSchemas.length > 0
  const showSettingTab = hasSetting && (!readonly || showReadOnlySettingDetails)
  const showSettingAsDetails = readonly && showReadOnlySettingDetails
  const [tempSetting, setTempSetting] = useState(setting)
  const [currType, setCurrType] = useState('info')
  useEffect(() => {
    setCurrType(!readonly && hasSetting ? 'setting' : 'info')
  }, [hasSetting])

  const effectiveSetting = addDefaultValue(
    tempSetting,
    settingSchemas.map((item) =>
      tempSetting[item.variable] == null ? item : { ...item, default: undefined },
    ),
  )
  const isValid = settingSchemas.every((item) => {
    const value = effectiveSetting[item.name]
    return !item.required || (value !== undefined && value !== null && value !== '')
  })

  const getType = (type: string) => {
    if (type === 'number-input') return t(($) => $['setBuiltInTools.number'], { ns: 'tools' })
    if (type === 'text-input') return t(($) => $['setBuiltInTools.string'], { ns: 'tools' })
    if (type === 'checkbox') return 'boolean'
    if (type === 'file') return t(($) => $['setBuiltInTools.file'], { ns: 'tools' })
    return type
  }

  const renderSchemaDetails = (schemas: typeof formSchemas) => (
    <div className="">
      {schemas.length > 0 && (
        <div className="space-y-1 py-2">
          {schemas.map((item) => (
            <div key={item.name} className="py-1">
              <div className="flex items-center gap-2">
                <div className="code-sm-semibold text-text-secondary">{item.label[language]}</div>
                <div className="system-xs-regular text-text-tertiary">{getType(item.type)}</div>
                {item.required && (
                  <div className="system-xs-medium text-text-warning-secondary">
                    {t(($) => $['setBuiltInTools.required'], { ns: 'tools' })}
                  </div>
                )}
              </div>
              {item.human_description && (
                <div className="mt-0.5 system-xs-regular text-text-tertiary">
                  {item.human_description?.[language]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
  const infoUI = renderSchemaDetails(infoSchemas)
  const settingDetailsUI = renderSchemaDetails(settingSchemas)

  const settingUI = (
    <Form
      value={effectiveSetting}
      onChange={setTempSetting}
      formSchemas={settingSchemas}
      isEditMode={false}
      showOnVariableMap={{}}
      validating={false}
      readonly={readonly}
      className="space-y-3"
      itemClassName="py-0!"
      fieldLabelClassName="mb-1 py-1!"
      override={[
        [FormTypeEnum.checkbox],
        (schema, { value, onChange, readonly: fieldReadonly }) => {
          if (schema.show_on.some((condition) => value[condition.variable] !== condition.value))
            return <React.Fragment key={schema.variable} />
          const label = schema.label[language] || schema.label.en_US
          const tooltip = schema.tooltip?.[language] || schema.tooltip?.en_US
          return (
            <Field
              key={schema.variable}
              name={schema.variable}
              className="flex min-h-6 items-center justify-between gap-3"
            >
              <div className="flex min-w-0 items-center">
                <FieldLabel className="py-0 system-sm-semibold">{label}</FieldLabel>
                {tooltip && (
                  <Infotip>
                    <InfotipTrigger aria-label={label} className="ms-1" />
                    <InfotipContent aria-label={label} className="w-50">
                      {tooltip}
                    </InfotipContent>
                  </Infotip>
                )}
              </div>
              <Switch
                checked={value[schema.variable] === true}
                disabled={fieldReadonly}
                onCheckedChange={(checked) => onChange({ ...value, [schema.variable]: checked })}
              />
            </Field>
          )
        },
      ]}
    />
  )

  return (
    <Drawer
      open
      modal
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open) onHide()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop className="bg-background-overlay" />
        <DrawerViewport>
          <DrawerPopup
            className={cn(
              'justify-start bg-components-panel-bg! p-0! shadow-xl data-[swipe-direction=right]:top-6 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-6 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-105 data-[swipe-direction=right]:max-w-105 data-[swipe-direction=right]:rounded-2xl',
            )}
          >
            <DrawerContent className="overflow-hidden">
              {isLoading && <LoadingPlaceholder className="h-full" />}
              {!isLoading && (
                <>
                  {/* header */}
                  <div className="relative shrink-0 border-b border-divider-subtle p-4 pb-3">
                    <div className="absolute inset-e-3 top-3">
                      <IconButton
                        aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                        onClick={onHide}
                      >
                        <RiCloseLine aria-hidden="true" className="size-4" />
                      </IconButton>
                    </div>
                    {showBackButton && (
                      <button
                        type="button"
                        className="mb-2 flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-start system-xs-semibold-uppercase text-text-accent-secondary"
                        onClick={onHide}
                      >
                        <RiArrowLeftLine className="size-4" />
                        {t(($) => $['detailPanel.operation.back'], { ns: 'plugin' })}
                      </button>
                    )}
                    <div className="flex items-center gap-1">
                      <Icon size="tiny" className="size-6" src={collection.icon} />
                      <OrgInfo
                        packageNameClassName="w-auto"
                        orgName={collection.author}
                        packageName={collection.name.split('/').pop() || ''}
                      />
                    </div>
                    <DrawerTitle className="mt-1 system-md-semibold text-text-primary">
                      {currTool?.label[language]}
                    </DrawerTitle>
                    {!!currTool?.description[language] && (
                      <Description
                        className="mt-3 mb-2 h-auto"
                        text={currTool.description[language]}
                        descriptionLineRows={2}
                      ></Description>
                    )}
                    {collection.allow_delete && collection.type === CollectionType.builtIn && (
                      <PluginAuthInAgent
                        pluginPayload={{
                          provider: collection.name,
                          category: AuthCategory.tool,
                          providerType: collection.type,
                          detail: collection as any,
                        }}
                        authorizationLabel={t(($) => $['auth.authorize'], { ns: 'plugin' })}
                        credentialId={credentialId}
                        onAuthorizationItemClick={onAuthorizationItemClick}
                      />
                    )}
                  </div>
                  {toolsLoad && toolsLoadErrorMessage && (
                    <Alert type="error" className="mx-4 mt-3 shrink-0">
                      <AlertTitle>{toolsLoadErrorMessage}</AlertTitle>
                      <AlertActions>
                        <Button size="small" loading={toolsLoad.retrying} onClick={toolsLoad.retry}>
                          {t(($) => $['operation.retry'], { ns: 'common' })}
                        </Button>
                      </AlertActions>
                    </Alert>
                  )}
                  <form
                    noValidate
                    className="flex min-h-0 flex-1 flex-col"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (isValid && !readonly) onSave?.(effectiveSetting)
                    }}
                  >
                    <Tabs
                      value={currType}
                      onValueChange={setCurrType}
                      className="flex min-h-0 flex-1 flex-col"
                    >
                      {showSettingTab ? (
                        <TabsList className="h-9.5 shrink-0 px-4 pt-1">
                          <TabsTab value="info" className="pt-2 pb-2 system-sm-semibold">
                            {t(($) => $['setBuiltInTools.parameters'], { ns: 'tools' })}
                          </TabsTab>
                          <TabsTab value="setting" className="pt-2 pb-2 system-sm-semibold">
                            {t(($) => $['setBuiltInTools.setting'], { ns: 'tools' })}
                          </TabsTab>
                          <TabsIndicator />
                        </TabsList>
                      ) : (
                        <div className="p-4 pb-1 system-sm-semibold-uppercase text-text-primary">
                          {t(($) => $['setBuiltInTools.parameters'], { ns: 'tools' })}
                        </div>
                      )}
                      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
                        {showSettingTab ? (
                          <>
                            <TabsPanel value="info">{infoUI}</TabsPanel>
                            <TabsPanel value="setting">
                              {showSettingAsDetails ? settingDetailsUI : settingUI}
                            </TabsPanel>
                          </>
                        ) : (
                          infoUI
                        )}
                      </div>
                    </Tabs>
                    <div className="flex shrink-0 items-center justify-end gap-3 border-t border-divider-subtle px-4 py-3">
                      <ReadmeEntrance
                        pluginDetail={collection as any}
                        showDivider={false}
                        className="min-w-0 flex-1 p-0"
                      />
                      {showSettingTab && !readonly && (
                        <div className="flex shrink-0 gap-2">
                          <Button onClick={onHide}>
                            {t(($) => $['operation.cancel'], { ns: 'common' })}
                          </Button>
                          <Button type="submit" variant="primary" disabled={!isValid}>
                            {t(($) => $['operation.save'], { ns: 'common' })}
                          </Button>
                        </div>
                      )}
                    </div>
                  </form>
                </>
              )}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
export default React.memo(SettingBuiltInTool)
