'use client'
import type { FC } from 'react'
import type { Collection, Tool } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import {
  RiArrowLeftLine,
  RiCloseLine,
} from '@remixicon/react'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Drawer from '@/app/components/base/drawer'
import Loading from '@/app/components/base/loading'
import TabSlider from '@/app/components/base/tab-slider-plain'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import Icon from '@/app/components/plugins/card/base/card-icon'
import Description from '@/app/components/plugins/card/base/description'
import OrgInfo from '@/app/components/plugins/card/base/org-info'
import {
  AuthCategory,
  PluginAuthInAgent,
} from '@/app/components/plugins/plugin-auth'
import { ReadmeEntrance } from '@/app/components/plugins/readme-panel/entrance'
import { CollectionType } from '@/app/components/tools/types'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import { useLocale } from '@/context/i18n'
import { getLanguage } from '@/i18n-config/language'
import { fetchBuiltInToolList, fetchCustomToolList, fetchModelToolList, fetchWorkflowToolList } from '@/service/tools'
import { cn } from '@/utils/classnames'

type Props = {
  showBackButton?: boolean
  collection: Collection | ToolWithProvider
  isBuiltIn?: boolean
  isModel?: boolean
  toolName: string
  setting?: Record<string, any>
  readonly?: boolean
  onHide: () => void
  onSave?: (value: Record<string, any>) => void
  credentialId?: string
  onAuthorizationItemClick?: (id: string) => void
}

const SettingBuiltInTool: FC<Props> = ({
  showBackButton = false,
  collection,
  isBuiltIn = true,
  isModel = true,
  toolName,
  setting = {},
  readonly,
  onHide,
  onSave,
  credentialId,
  onAuthorizationItemClick,
}) => {
  const locale = useLocale()
  const language = getLanguage(locale)
  const { t } = useTranslation()
  const passedTools = (collection as ToolWithProvider).tools
  const hasPassedTools = passedTools?.length > 0
  const [isLoading, setIsLoading] = useState(!hasPassedTools)
  const [tools, setTools] = useState<Tool[]>(hasPassedTools ? passedTools : [])
  const currTool = tools.find(tool => tool.name === toolName)
  const formSchemas = currTool ? toolParametersToFormSchemas(currTool.parameters) : []
  const infoSchemas = formSchemas.filter(item => item.form === 'llm')
  const settingSchemas = formSchemas.filter(item => item.form !== 'llm')
  const hasSetting = settingSchemas.length > 0
  const [tempSetting, setTempSetting] = useState(setting)
  const [currType, setCurrType] = useState('info')
  const isInfoActive = currType === 'info'
  useEffect(() => {
    if (!collection || hasPassedTools)
      return

    (async () => {
      setIsLoading(true)
      try {
        const list = await new Promise<Tool[]>((resolve) => {
          (async function () {
            if (isModel)
              resolve(await fetchModelToolList(collection.name))
            else if (isBuiltIn)
              resolve(await fetchBuiltInToolList(collection.name))
            else if (collection.type === CollectionType.workflow)
              resolve(await fetchWorkflowToolList(collection.id))
            else
              resolve(await fetchCustomToolList(collection.name))
          }())
        })
        setTools(list)
      }
      catch { }
      setIsLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection?.name, collection?.id, collection?.type])

  useEffect(() => {
    setCurrType((!readonly && hasSetting) ? 'setting' : 'info')
  }, [hasSetting])

  const isValid = (() => {
    let valid = true
    settingSchemas.forEach((item) => {
      if (item.required && !tempSetting[item.name])
        valid = false
    })
    return valid
  })()

  const getType = (type: string) => {
    if (type === 'number-input')
      return t('setBuiltInTools.number', { ns: 'tools' })
    if (type === 'text-input')
      return t('setBuiltInTools.string', { ns: 'tools' })
    if (type === 'checkbox')
      return 'boolean'
    if (type === 'file')
      return t('setBuiltInTools.file', { ns: 'tools' })
    return type
  }

  const infoUI = (
    <div className="">
      {infoSchemas.length > 0 && (
        <div className="space-y-1 py-2">
          {infoSchemas.map((item, index) => (
            <div key={index} className="py-1">
              <div className="flex items-center gap-2">
                <div className="code-sm-semibold text-text-secondary">{item.label[language]}</div>
                <div className="system-xs-regular text-text-tertiary">
                  {getType(item.type)}
                </div>
                {item.required && (
                  <div className="system-xs-medium text-text-warning-secondary">{t('setBuiltInTools.required', { ns: 'tools' })}</div>
                )}
              </div>
              {item.human_description && (
                <div className="system-xs-regular mt-0.5 text-text-tertiary">
                  {item.human_description?.[language]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const settingUI = (
    <Form
      value={tempSetting}
      onChange={setTempSetting}
      formSchemas={settingSchemas}
      isEditMode={false}
      showOnVariableMap={{}}
      validating={false}
      readonly={readonly}
    />
  )

  return (
    <Drawer
      isOpen
      clickOutsideNotOpen={false}
      onClose={onHide}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassName={cn('mb-2 mr-2 mt-[64px] !w-[420px] !max-w-[420px] justify-start rounded-2xl border-[0.5px] border-components-panel-border !bg-components-panel-bg !p-0 shadow-xl')}
    >
      <>
        {isLoading && <Loading type="app" />}
        {!isLoading && (
          <>
            {/* header */}
            <div className="relative border-b border-divider-subtle p-4 pb-3">
              <div className="absolute right-3 top-3">
                <ActionButton onClick={onHide}>
                  <RiCloseLine className="h-4 w-4" />
                </ActionButton>
              </div>
              {showBackButton && (
                <div
                  className="system-xs-semibold-uppercase mb-2 flex cursor-pointer items-center gap-1 text-text-accent-secondary"
                  onClick={onHide}
                >
                  <RiArrowLeftLine className="h-4 w-4" />
                  {t('detailPanel.operation.back', { ns: 'plugin' })}
                </div>
              )}
              <div className="flex items-center gap-1">
                <Icon size="tiny" className="h-6 w-6" src={collection.icon} />
                <OrgInfo
                  packageNameClassName="w-auto"
                  orgName={collection.author}
                  packageName={collection.name.split('/').pop() || ''}
                />
              </div>
              <div className="system-md-semibold mt-1 text-text-primary">{currTool?.label[language]}</div>
              {!!currTool?.description[language] && (
                <Description className="mb-2 mt-3 h-auto" text={currTool.description[language]} descriptionLineRows={2}></Description>
              )}
              {
                collection.allow_delete && collection.type === CollectionType.builtIn && (
                  <PluginAuthInAgent
                    pluginPayload={{
                      provider: collection.name,
                      category: AuthCategory.tool,
                      providerType: collection.type,
                      detail: collection as any,
                    }}
                    credentialId={credentialId}
                    onAuthorizationItemClick={onAuthorizationItemClick}
                  />
                )
              }
            </div>
            {/* form */}
            <div className="h-full">
              <div className="flex h-full flex-col">
                {(hasSetting && !readonly)
                  ? (
                      <TabSlider
                        className="mt-1 shrink-0 px-4"
                        itemClassName="py-3"
                        noBorderBottom
                        value={currType}
                        onChange={(value) => {
                          setCurrType(value)
                        }}
                        options={[
                          { value: 'info', text: t('setBuiltInTools.parameters', { ns: 'tools' })! },
                          { value: 'setting', text: t('setBuiltInTools.setting', { ns: 'tools' })! },
                        ]}
                      />
                    )
                  : (
                      <div className="system-sm-semibold-uppercase p-4 pb-1 text-text-primary">{t('setBuiltInTools.parameters', { ns: 'tools' })}</div>
                    )}
                <div className="h-0 grow overflow-y-auto px-4">
                  {isInfoActive ? infoUI : settingUI}
                  {!readonly && !isInfoActive && (
                    <div className="flex shrink-0 justify-end space-x-2 rounded-b-[10px] bg-components-panel-bg py-2">
                      <Button className="flex h-8 items-center !px-3 !text-[13px] font-medium " onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
                      <Button className="flex h-8 items-center !px-3 !text-[13px] font-medium" variant="primary" disabled={!isValid} onClick={() => onSave?.(tempSetting)}>{t('operation.save', { ns: 'common' })}</Button>
                    </div>
                  )}
                </div>
                <ReadmeEntrance pluginDetail={collection as any} className="mt-auto" />
              </div>
            </div>
          </>
        )}
      </>
    </Drawer>
  )
}
export default React.memo(SettingBuiltInTool)
