import type { PluginDetail } from '@/app/components/plugins/types'
import type { Emoji } from '@/app/components/tools/types'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RiAlertFill } from '@remixicon/react'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { InfoCircle } from '@/app/components/base/icons/src/vender/line/general'
import Modal from '@/app/components/base/modal'
import { useSelectOrDelete } from '@/app/components/base/prompt-editor/hooks'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ToolAuthorizationSection from '@/app/components/plugins/plugin-detail-panel/tool-selector/sections/tool-authorization-section'
import { ReadmeEntrance } from '@/app/components/plugins/readme-panel/entrance'
import { ReadmeShowType } from '@/app/components/plugins/readme-panel/store'
import { CollectionType } from '@/app/components/tools/types'
import { generateFormValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { START_TAB_ID } from '@/app/components/workflow/skill/constants'
import ToolSettingsSection from '@/app/components/workflow/skill/editor/skill-editor/tool-setting/tool-settings-section'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { Theme } from '@/types/app'
import { canFindTool } from '@/utils'
import { cn } from '@/utils/classnames'
import { basePath } from '@/utils/var'
import { DELETE_TOOL_BLOCK_COMMAND } from './index'
import { useToolBlockContext } from './tool-block-context'
import ToolHeader from './tool-header'

type ToolBlockComponentProps = {
  nodeKey: string
  provider: string
  tool: string
  configId: string
  label?: string
  icon?: string | Emoji
  iconDark?: string | Emoji
}

const normalizeProviderIcon = (icon?: ToolWithProvider['icon']) => {
  if (!icon)
    return icon
  if (typeof icon === 'string' && basePath && icon.startsWith('/') && !icon.startsWith(`${basePath}/`))
    return `${basePath}${icon}`
  return icon
}

type ToolConfigField = {
  id: string
  value: unknown
  auto: boolean
}

type ToolConfigMetadata = {
  type: 'mcp' | 'builtin'
  configuration: {
    fields: ToolConfigField[]
  }
  enabled?: boolean
  credential_id?: string
}

type SkillFileMetadata = {
  tools?: Record<string, ToolConfigMetadata>
}

const getVarKindType = (type: FormTypeEnum | string) => {
  if (type === FormTypeEnum.file || type === FormTypeEnum.files)
    return VarKindType.variable
  if (type === FormTypeEnum.select || type === FormTypeEnum.checkbox || type === FormTypeEnum.textNumber || type === FormTypeEnum.array || type === FormTypeEnum.object)
    return VarKindType.constant
  if (type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput)
    return VarKindType.mixed
  return VarKindType.constant
}

const normalizeCredentialId = (credentialId?: string) => {
  if (!credentialId || credentialId === '__workspace_default__')
    return undefined
  return credentialId
}

type ToolFormSchema = {
  variable: string
  type: string
  default?: unknown
}

type ToolConfigValueItem = {
  auto?: 0 | 1
  value?: {
    type: VarKindType
    value?: unknown
  } | null
}

type ToolConfigValueMap = Record<string, ToolConfigValueItem>

const ToolBlockComponent = ({
  nodeKey,
  provider,
  tool,
  configId,
  label,
  icon,
  iconDark,
}: ToolBlockComponentProps) => {
  const [editor] = useLexicalComposerContext()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_TOOL_BLOCK_COMMAND)
  const language = useGetLanguage()
  const { t } = useTranslation()
  const authBadgeLabel = t('skillEditor.authorizationBadge', { ns: 'workflow' })
  const { theme } = useTheme()
  const toolBlockContext = useToolBlockContext()
  const isUsingExternalMetadata = Boolean(toolBlockContext?.onMetadataChange)
  const useModal = Boolean(toolBlockContext?.useModal)
  const [isSettingOpen, setIsSettingOpen] = useState(false)
  const [toolValue, setToolValue] = useState<ToolValue | null>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const activeTabId = useStore(s => s.activeTabId)
  const fileMetadata = useStore(s => s.fileMetadata)
  const storeApi = useWorkflowStore()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const mergedTools = useMemo(() => {
    return [buildInTools, customTools, workflowTools, mcpTools].filter(Boolean) as ToolWithProvider[][]
  }, [buildInTools, customTools, workflowTools, mcpTools])

  const currentProvider = useMemo(() => {
    for (const collection of mergedTools) {
      const providerItem = collection.find(item => item.name === provider || item.id === provider || canFindTool(item.id, provider))
      if (providerItem)
        return providerItem
    }
    return undefined
  }, [mergedTools, provider])

  const currentTool = useMemo(() => {
    if (!currentProvider)
      return undefined
    return currentProvider.tools?.find(item => item.name === tool)
  }, [currentProvider, tool])

  const toolMeta = useMemo(() => {
    if (!currentProvider || !currentTool)
      return null
    return {
      label: currentTool.label?.[language] || tool,
      icon: currentProvider.icon,
      iconDark: currentProvider.icon_dark,
    }
  }, [currentProvider, currentTool, language, tool])

  const toolDescriptionText = useMemo(() => {
    if (toolValue?.tool_description)
      return toolValue.tool_description
    if (currentTool?.description) {
      return typeof currentTool.description === 'object'
        ? (currentTool.description?.[language] || '')
        : (currentTool.description || '')
    }
    return ''
  }, [currentTool?.description, language, toolValue?.tool_description])

  const toolConfigFromMetadata = useMemo(() => {
    if (isUsingExternalMetadata) {
      const metadata = toolBlockContext?.metadata as SkillFileMetadata | undefined
      return metadata?.tools?.[configId]
    }
    if (!activeTabId || activeTabId === START_TAB_ID)
      return undefined
    const metadata = fileMetadata.get(activeTabId) as SkillFileMetadata | undefined
    return metadata?.tools?.[configId]
  }, [activeTabId, configId, fileMetadata, isUsingExternalMetadata, toolBlockContext?.metadata])

  const isInteractive = editor.isEditable()

  const defaultToolValue = useMemo(() => {
    if (!currentProvider || !currentTool)
      return null
    const settingsSchemas = toolParametersToFormSchemas(currentTool.parameters?.filter(param => param.form !== 'llm') || []) as ToolFormSchema[]
    const paramsSchemas = toolParametersToFormSchemas(currentTool.parameters?.filter(param => param.form === 'llm') || []) as ToolFormSchema[]
    const toolLabel = currentTool.label?.[language] || tool
    const toolDescription = typeof currentTool.description === 'object'
      ? (currentTool.description?.[language] || '')
      : (currentTool.description || '')
    return {
      provider_name: currentProvider.id,
      provider_show_name: currentProvider.name,
      tool_name: currentTool.name,
      tool_label: toolLabel,
      tool_description: toolDescription,
      settings: generateFormValue({}, settingsSchemas),
      parameters: generateFormValue({}, paramsSchemas, true),
      enabled: true,
      extra: { description: toolDescription },
    } as ToolValue
  }, [currentProvider, currentTool, language, tool])

  const configuredToolValue = useMemo(() => {
    if (!defaultToolValue || !currentTool)
      return defaultToolValue
    const fields = toolConfigFromMetadata?.configuration?.fields ?? []
    if (!fields.length)
      return defaultToolValue

    const fieldsById = new Map(fields.map(field => [field.id, field]))
    const settingsSchemas = toolParametersToFormSchemas(currentTool.parameters?.filter(param => param.form !== 'llm') || []) as ToolFormSchema[]
    const paramsSchemas = toolParametersToFormSchemas(currentTool.parameters?.filter(param => param.form === 'llm') || []) as ToolFormSchema[]

    const applyFields = (schemas: ToolFormSchema[]) => {
      const nextValue: ToolConfigValueMap = {}
      schemas.forEach((schema) => {
        const field = fieldsById.get(schema.variable)
        if (!field)
          return
        const isAuto = Boolean(field.auto)
        if (isAuto) {
          nextValue[schema.variable] = { auto: 1, value: null }
          return
        }
        nextValue[schema.variable] = {
          auto: 0,
          value: {
            type: getVarKindType(schema.type),
            value: field.value ?? null,
          },
        }
      })
      return nextValue
    }

    return {
      ...defaultToolValue,
      settings: {
        ...(defaultToolValue.settings || {}),
        ...applyFields(settingsSchemas),
      },
      parameters: {
        ...(defaultToolValue.parameters || {}),
        ...applyFields(paramsSchemas),
      },
      credential_id: toolConfigFromMetadata?.credential_id ?? defaultToolValue.credential_id,
    }
  }, [currentTool, defaultToolValue, toolConfigFromMetadata])

  useEffect(() => {
    if (!configuredToolValue)
      return
    if (!toolValue || toolValue.tool_name !== configuredToolValue.tool_name || toolValue.provider_name !== configuredToolValue.provider_name)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setToolValue(configuredToolValue)
  }, [configuredToolValue, toolValue])

  useEffect(() => {
    if (!isSettingOpen || !configuredToolValue)
      return
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setToolValue(configuredToolValue)
  }, [configuredToolValue, isSettingOpen])

  useEffect(() => {
    if (useModal)
      return
    const containerFromRef = ref.current?.closest('[data-skill-editor-root="true"]') as HTMLElement | null
    const fallbackContainer = document.querySelector('[data-skill-editor-root="true"]') as HTMLElement | null
    const container = containerFromRef || fallbackContainer
    if (container)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setPortalContainer(container)
  }, [ref, useModal])

  useEffect(() => {
    if (!isSettingOpen || useModal)
      return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null
      const triggerEl = ref.current
      const panelEl = portalContainer?.querySelector('[data-tool-setting-panel="true"]')
      if (!target || !panelEl)
        return
      if (target instanceof Element && target.closest('[data-readme-panel-root="true"], [data-readme-panel="true"]'))
        return
      if (target instanceof Element && target.closest('[data-plugin-auth-portal="true"], [data-plugin-auth-panel="true"]'))
        return
      if (target instanceof Element && target.closest('[data-modal-root="true"]'))
        return
      if (panelEl.contains(target))
        return
      if (triggerEl && triggerEl.contains(target))
        return
      setIsSettingOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isSettingOpen, portalContainer, ref, useModal])

  const displayLabel = label || toolMeta?.label || tool
  const resolvedIcon = (() => {
    const fromNode = theme === Theme.dark ? iconDark : icon
    if (fromNode)
      return normalizeProviderIcon(fromNode)
    const fromMeta = theme === Theme.dark ? toolMeta?.iconDark : toolMeta?.icon
    return normalizeProviderIcon(fromMeta)
  })()

  const needAuthorization = useMemo(() => {
    if (!currentProvider)
      return false
    return !currentProvider.is_team_authorization
  }, [currentProvider])

  const renderIcon = () => {
    if (!resolvedIcon)
      return null
    const iconNode = (() => {
      if (typeof resolvedIcon === 'string') {
        if (resolvedIcon.startsWith('http') || resolvedIcon.startsWith('/')) {
          return (
            <span
              className="h-[14px] w-[14px] shrink-0 rounded-[3px] bg-cover bg-center"
              style={{ backgroundImage: `url(${resolvedIcon})` }}
            />
          )
        }
        return (
          <AppIcon
            size="xs"
            icon={resolvedIcon}
            className="!h-[14px] !w-[14px] shrink-0 !border-0"
          />
        )
      }
      return (
        <AppIcon
          size="xs"
          icon={resolvedIcon.content}
          background={resolvedIcon.background}
          className="!h-[14px] !w-[14px] shrink-0 !border-0"
        />
      )
    })()
    if (!needAuthorization)
      return iconNode
    return (
      <span className="flex size-4 items-center justify-center rounded-[5px] border border-components-panel-border-subtle bg-background-default-dodge">
        {iconNode}
      </span>
    )
  }

  const handleToolValueChange = (nextValue: ToolValue) => {
    setToolValue(nextValue)
    if (!currentProvider || !currentTool)
      return
    const credentialId = normalizeCredentialId(nextValue.credential_id)
    if (isUsingExternalMetadata) {
      const metadata = (toolBlockContext?.metadata || {}) as SkillFileMetadata
      const toolType = currentProvider.type === CollectionType.mcp ? 'mcp' : 'builtin'
      const buildFields = (value: Record<string, unknown> | undefined) => {
        if (!value)
          return []
        return Object.entries(value).map(([id, field]) => {
          const fieldValue = field as ToolConfigValueItem | undefined
          const auto = Boolean(fieldValue?.auto)
          const rawValue = auto ? null : fieldValue?.value?.value ?? null
          return { id, value: rawValue, auto }
        })
      }
      const fields = [
        ...buildFields(nextValue.settings),
        ...buildFields(nextValue.parameters),
      ]
      const nextMetadata: SkillFileMetadata = {
        ...metadata,
        tools: {
          ...(metadata.tools || {}),
          [configId]: {
            type: toolType,
            configuration: { fields },
            ...(credentialId ? { credential_id: credentialId } : {}),
          },
        },
      }
      toolBlockContext?.onMetadataChange?.(nextMetadata)
      return
    }
    if (!activeTabId || activeTabId === START_TAB_ID)
      return
    const metadata = (fileMetadata.get(activeTabId) || {}) as SkillFileMetadata
    const toolType = currentProvider.type === CollectionType.mcp ? 'mcp' : 'builtin'
    const buildFields = (value: Record<string, unknown> | undefined) => {
      if (!value)
        return []
      return Object.entries(value).map(([id, field]) => {
        const fieldValue = field as ToolConfigValueItem | undefined
        const auto = Boolean(fieldValue?.auto)
        const rawValue = auto ? null : fieldValue?.value?.value ?? null
        return { id, value: rawValue, auto }
      })
    }
    const fields = [
      ...buildFields(nextValue.settings),
      ...buildFields(nextValue.parameters),
    ]
    const nextMetadata: SkillFileMetadata = {
      ...metadata,
      tools: {
        ...(metadata.tools || {}),
        [configId]: {
          type: toolType,
          configuration: { fields },
          ...(credentialId ? { credential_id: credentialId } : {}),
        },
      },
    }
    storeApi.getState().setDraftMetadata(activeTabId, nextMetadata)
    storeApi.getState().pinTab(activeTabId)
  }

  const handleAuthorizationItemClick = (id: string) => {
    const credentialId = normalizeCredentialId(id)
    setToolValue(prev => (prev ? { ...prev, credential_id: credentialId } : prev))
    if (!currentProvider)
      return
    const applyCredential = (metadata: SkillFileMetadata | undefined) => {
      const nextMetadata: SkillFileMetadata = {
        ...(metadata || {}),
        tools: {
          ...(metadata?.tools || {}),
        },
      }
      const existing = nextMetadata.tools?.[configId]
      const toolType = existing?.type || (currentProvider.type === CollectionType.mcp ? 'mcp' : 'builtin')
      const nextEntry: ToolConfigMetadata = {
        type: toolType,
        configuration: existing?.configuration || { fields: [] },
        ...(existing?.enabled !== undefined ? { enabled: existing.enabled } : {}),
      }
      if (credentialId)
        nextEntry.credential_id = credentialId
      if (!nextMetadata.tools)
        nextMetadata.tools = {}
      nextMetadata.tools[configId] = nextEntry
      return nextMetadata
    }
    if (isUsingExternalMetadata) {
      toolBlockContext?.onMetadataChange?.(applyCredential(toolBlockContext?.metadata as SkillFileMetadata | undefined))
      return
    }
    if (!activeTabId || activeTabId === START_TAB_ID)
      return
    const metadata = fileMetadata.get(activeTabId) as SkillFileMetadata | undefined
    const nextMetadata = applyCredential(metadata)
    storeApi.getState().setDraftMetadata(activeTabId, nextMetadata)
    storeApi.getState().pinTab(activeTabId)
  }

  const readmeEntrance = useMemo(() => {
    if (!currentProvider)
      return null
    return <ReadmeEntrance pluginDetail={currentProvider as unknown as PluginDetail} showType={ReadmeShowType.drawer} className="mt-auto" />
  }, [currentProvider])

  const toolSettingsContent = currentProvider && currentTool && toolValue && (
    <div className="flex min-h-full flex-col">
      <ToolHeader
        icon={resolvedIcon}
        providerLabel={currentProvider.label?.[language] || currentProvider.name || provider}
        toolLabel={toolValue.tool_label || displayLabel}
        description={toolDescriptionText}
        onClose={() => setIsSettingOpen(false)}
      />

      <ToolAuthorizationSection
        currentProvider={currentProvider}
        credentialId={toolValue.credential_id}
        onAuthorizationItemClick={handleAuthorizationItemClick}
      />
      {needAuthorization && (
        <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center px-4 py-6 text-text-tertiary">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-divider-subtle">
            <InfoCircle className="h-4 w-4 text-text-tertiary" />
          </div>
          <div className="system-xs-regular mt-3 text-text-tertiary">
            {t('skillEditor.authorizationRequired', { ns: 'workflow' })}
          </div>
        </div>
      )}
      <ToolSettingsSection
        currentProvider={currentProvider}
        currentTool={currentTool}
        value={toolValue}
        onChange={handleToolValueChange}
        nodeId={undefined}
      />
      {readmeEntrance}
    </div>
  )

  return (
    <>
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-[2px] rounded-[5px] border py-px pl-px pr-[3px] shadow-xs',
          isInteractive ? 'cursor-pointer' : 'cursor-default',
          needAuthorization ? 'border-state-warning-active bg-state-warning-hover' : 'border-state-accent-hover-alt bg-state-accent-hover',
          isSelected && 'border-text-accent',
        )}
        title={`${provider}.${tool}`}
        data-tool-config-id={configId}
        onMouseDown={() => {
          if (!isInteractive)
            return
          if (!currentProvider || !currentTool)
            return
          if (configuredToolValue)
            setToolValue(configuredToolValue)
          setIsSettingOpen(true)
        }}
      >
        {renderIcon()}
        <span className={cn('system-xs-medium max-w-[180px] truncate', needAuthorization ? 'text-text-warning' : 'text-text-accent')}>
          {displayLabel}
        </span>
        {needAuthorization && (
          <span className="system-2xs-medium-uppercase flex h-4 items-center gap-0.5 rounded-[5px] border border-text-warning bg-components-badge-bg-dimm px-1 text-text-warning">
            {authBadgeLabel}
            <RiAlertFill className="h-3 w-3" />
          </span>
        )}
      </span>
      {useModal && (
        <Modal
          isShow={isSettingOpen}
          onClose={() => setIsSettingOpen(false)}
          className="!max-w-[420px] !bg-transparent !p-0"
          overflowVisible
        >
          <div className={cn('relative min-h-20 w-[361px] overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pb-4 shadow-lg backdrop-blur-sm', 'overflow-y-auto pb-2')}>
            {toolSettingsContent}
          </div>
        </Modal>
      )}
      {!useModal && portalContainer && isSettingOpen && createPortal(
        <div
          className="absolute bottom-4 right-4 top-4 z-[99]"
          data-tool-setting-panel="true"
        >
          <div className={cn('relative h-full min-h-20 w-[361px] overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pb-4 shadow-lg backdrop-blur-sm', 'overflow-y-auto pb-2')}>
            {toolSettingsContent}
          </div>
        </div>,
        portalContainer,
      )}
    </>
  )
}

export default React.memo(ToolBlockComponent)
