import type { ToolToken } from './utils'
import type { PluginDetail } from '@/app/components/plugins/types'
import type { ToolParameter } from '@/app/components/tools/types'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import Link from 'next/link'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import AppIcon from '@/app/components/base/app-icon'
import Modal from '@/app/components/base/modal'
import { useSelectOrDelete } from '@/app/components/base/prompt-editor/hooks'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
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

type ToolGroupBlockComponentProps = {
  nodeKey: string
  tools: ToolToken[]
}

type ToolConfigField = {
  id: string
  value: unknown
  auto?: boolean
}

type ToolConfigMetadata = {
  type: 'mcp' | 'builtin'
  configuration: {
    fields: ToolConfigField[]
  }
  enabled?: boolean
  credential_id?: string
  [key: string]: string | boolean | number | undefined | object// Add index signature to allow string keys
}

type SkillFileMetadata = {
  tools?: Record<string, ToolConfigMetadata>
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

type ToolItem = {
  configId: string
  providerId: string
  toolName: string
  toolLabel: string
  toolDescription: string
  providerIcon?: ToolWithProvider['icon']
  providerIconDark?: ToolWithProvider['icon']
  providerType?: ToolWithProvider['type']
  providerName?: string
  providerLabel?: string
  toolParams?: ToolParameter[]
}

const normalizeProviderIcon = (icon?: ToolWithProvider['icon']) => {
  if (!icon)
    return icon
  if (typeof icon === 'string' && basePath && icon.startsWith('/') && !icon.startsWith(`${basePath}/`))
    return `${basePath}${icon}`
  return icon
}

const ToolGroupBlockComponent = ({
  nodeKey,
  tools,
}: ToolGroupBlockComponentProps) => {
  const [editor] = useLexicalComposerContext()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_TOOL_BLOCK_COMMAND)
  const { t } = useTranslation()
  const authBadgeLabel = t('skillEditor.authorizationBadge', { ns: 'workflow' })
  const language = useGetLanguage()
  const { theme } = useTheme()
  const {
    metadata,
    onMetadataChange,
    useModal,
    nodeId: contextNodeId,
    nodesOutputVars,
    availableNodes,
  } = useToolBlockContext(
    useShallow(context => ({
      metadata: context?.metadata,
      onMetadataChange: context?.onMetadataChange,
      useModal: context?.useModal,
      nodeId: context?.nodeId,
      nodesOutputVars: context?.nodesOutputVars,
      availableNodes: context?.availableNodes,
    })),
  )
  const isUsingExternalMetadata = Boolean(onMetadataChange)
  const useModalValue = Boolean(useModal)
  const isInteractive = editor.isEditable()
  const [isSettingOpen, setIsSettingOpen] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null)
  const [toolValue, setToolValue] = useState<ToolValue | null>(null)
  const [enabledByConfigId, setEnabledByConfigId] = useState<Record<string, boolean>>({})
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const activeTabId = useStore(s => s.activeTabId)
  const fileMetadata = useStore(s => s.fileMetadata)
  const storeApi = useWorkflowStore()

  const mergedTools = useMemo(() => {
    return [buildInTools, customTools, workflowTools, mcpTools].filter(Boolean) as ToolWithProvider[][]
  }, [buildInTools, customTools, workflowTools, mcpTools])

  const providerId = tools[0]?.provider || ''
  const currentProvider = useMemo(() => {
    if (!providerId)
      return undefined
    for (const collection of mergedTools) {
      const providerItem = collection.find(item => item.name === providerId || item.id === providerId || canFindTool(item.id, providerId))
      if (providerItem)
        return providerItem
    }
    return undefined
  }, [mergedTools, providerId])

  const providerLabel = currentProvider?.label?.[language] || currentProvider?.name || providerId
  const providerAuthor = currentProvider?.author
  const providerDescription = useMemo(() => {
    if (!currentProvider?.description)
      return ''
    return currentProvider.description?.[language] || currentProvider.description?.['en-US'] || Object.values(currentProvider.description).find(Boolean) || ''
  }, [currentProvider?.description, language])
  const resolvedIcon = (() => {
    const fromMeta = theme === Theme.dark ? currentProvider?.icon_dark : currentProvider?.icon
    return normalizeProviderIcon(fromMeta)
  })()

  const toolItems = useMemo<ToolItem[]>(() => {
    if (!currentProvider)
      return []
    return tools.map((toolToken) => {
      const tool = currentProvider.tools?.find(item => item.name === toolToken.tool)
      const toolLabel = tool?.label?.[language] || toolToken.tool
      const toolDescription = tool?.description?.[language] || ''
      return {
        configId: toolToken.configId,
        providerId: toolToken.provider,
        toolName: toolToken.tool,
        toolLabel,
        toolDescription,
        providerIcon: currentProvider.icon,
        providerIconDark: currentProvider.icon_dark,
        providerType: currentProvider.type,
        providerName: currentProvider.name,
        providerLabel: currentProvider.label?.[language] || currentProvider.name,
        toolParams: tool?.parameters,
      }
    })
  }, [currentProvider, language, tools])
  const missingToolCount = useMemo(() => {
    if (!tools.length)
      return 0
    if (!currentProvider)
      return tools.length
    const availableToolNames = new Set(currentProvider.tools?.map(item => item.name) || [])
    return tools.reduce((count, item) => count + (availableToolNames.has(item.tool) ? 0 : 1), 0)
  }, [currentProvider, tools])
  const isToolMissing = missingToolCount > 0
  const missingDisplayLabel = useMemo(() => {
    if (!isToolMissing)
      return providerLabel
    const firstSegment = providerLabel.split('/').map(item => item.trim()).filter(Boolean)[0]
    return firstSegment || providerLabel
  }, [isToolMissing, providerLabel])

  const activeToolItem = useMemo(() => {
    if (!expandedToolId)
      return undefined
    return toolItems.find(item => item.configId === expandedToolId)
  }, [expandedToolId, toolItems])

  const currentTool = useMemo(() => {
    if (!activeToolItem || !currentProvider)
      return undefined
    return currentProvider.tools?.find(item => item.name === activeToolItem.toolName)
  }, [activeToolItem, currentProvider])

  const toolConfigFromMetadata = useMemo(() => {
    if (!activeToolItem)
      return undefined
    if (isUsingExternalMetadata) {
      const externalMetadata = metadata as SkillFileMetadata | undefined
      return externalMetadata?.tools?.[activeToolItem.configId]
    }
    if (!activeTabId)
      return undefined
    const resultMetadata = fileMetadata.get(activeTabId) as SkillFileMetadata | undefined
    return resultMetadata?.tools?.[activeToolItem.configId]
  }, [activeTabId, activeToolItem, fileMetadata, isUsingExternalMetadata, metadata])

  const metadataTools = useMemo(() => {
    if (isUsingExternalMetadata)
      return ((metadata as SkillFileMetadata | undefined)?.tools || {}) as Record<string, ToolConfigMetadata>
    if (!activeTabId || activeTabId === START_TAB_ID)
      return {}
    return ((fileMetadata.get(activeTabId) as SkillFileMetadata | undefined)?.tools || {}) as Record<string, ToolConfigMetadata>
  }, [activeTabId, fileMetadata, isUsingExternalMetadata, metadata])

  const getVarKindType = (type: FormTypeEnum | string) => {
    if (type === FormTypeEnum.file || type === FormTypeEnum.files)
      return VarKindType.variable
    if (type === FormTypeEnum.select || type === FormTypeEnum.checkbox || type === FormTypeEnum.textNumber || type === FormTypeEnum.array || type === FormTypeEnum.object)
      return VarKindType.constant
    if (type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput)
      return VarKindType.mixed
    return VarKindType.constant
  }

  const canUseAutoByType = (type: string) =>
    ![FormTypeEnum.modelSelector, FormTypeEnum.appSelector].includes(type as FormTypeEnum)

  const normalizeCredentialId = (credentialId?: string) => {
    if (!credentialId || credentialId === '__workspace_default__')
      return undefined
    return credentialId
  }

  const defaultToolValue = useMemo(() => {
    if (!currentProvider || !currentTool || !activeToolItem)
      return null
    const settingsSchemas = toolParametersToFormSchemas(currentTool.parameters?.filter(param => param.form !== 'llm') || []) as ToolFormSchema[]
    const paramsSchemas = toolParametersToFormSchemas(currentTool.parameters?.filter(param => param.form === 'llm') || []) as ToolFormSchema[]
    const toolLabel = currentTool.label?.[language] || activeToolItem.toolName
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
  }, [activeToolItem, currentProvider, currentTool, language])

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
        const isAuto = field.auto === undefined
          ? canUseAutoByType(schema.type)
          : Boolean(field.auto)
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

  const needAuthorization = useMemo(() => {
    if (!currentProvider)
      return false
    return !currentProvider.is_team_authorization
  }, [currentProvider])

  const readmeEntrance = useMemo(() => {
    if (!currentProvider)
      return null
    return <ReadmeEntrance pluginDetail={currentProvider as unknown as PluginDetail} showType={ReadmeShowType.drawer} className="mt-auto" />
  }, [currentProvider])

  const toolDescriptionText = useMemo(() => {
    if (toolValue?.tool_description)
      return toolValue.tool_description
    if (currentTool?.description) {
      return typeof currentTool.description === 'object'
        ? (currentTool.description?.[language] || '')
        : (currentTool.description || '')
    }
    return activeToolItem?.toolDescription || ''
  }, [activeToolItem?.toolDescription, currentTool?.description, language, toolValue?.tool_description])

  useEffect(() => {
    if (!configuredToolValue)
      return
    if (!toolValue || toolValue.tool_name !== configuredToolValue.tool_name || toolValue.provider_name !== configuredToolValue.provider_name)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setToolValue(configuredToolValue)
  }, [configuredToolValue, toolValue])

  useEffect(() => {
    if (expandedToolId)
      return
    if (toolValue)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setToolValue(null)
  }, [expandedToolId, toolValue])

  useEffect(() => {
    if (!isSettingOpen || !configuredToolValue)
      return
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setToolValue(configuredToolValue)
  }, [configuredToolValue, isSettingOpen])

  useEffect(() => {
    if (useModalValue)
      return
    const containerFromRef = ref.current?.closest('[data-skill-editor-root="true"]') as HTMLElement | null
    const fallbackContainer = document.querySelector('[data-skill-editor-root="true"]') as HTMLElement | null
    const container = containerFromRef || fallbackContainer
    if (container)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setPortalContainer(container)
  }, [ref, useModalValue])

  useEffect(() => {
    if (!isSettingOpen || useModalValue)
      return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null
      const triggerEl = ref.current
      const panelEl = portalContainer?.querySelector('[data-tool-group-setting-panel="true"]')
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
      setExpandedToolId(null)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isSettingOpen, portalContainer, ref, useModalValue])

  const resolvedEnabledByConfigId = useMemo(() => {
    const next = { ...enabledByConfigId }
    toolItems.forEach((item) => {
      const enabledFromMetadata = metadataTools[item.configId]?.enabled
      if (enabledFromMetadata !== undefined) {
        next[item.configId] = enabledFromMetadata
        return
      }
      if (next[item.configId] === undefined)
        next[item.configId] = true
    })
    return next
  }, [enabledByConfigId, metadataTools, toolItems])

  const enabledCount = useMemo(() => {
    if (!toolItems.length)
      return 0
    return toolItems.reduce((count, item) => count + (resolvedEnabledByConfigId[item.configId] === false ? 0 : 1), 0)
  }, [resolvedEnabledByConfigId, toolItems])
  const displayEnabledCount = needAuthorization ? 0 : enabledCount

  const handleToolValueChange = (nextValue: ToolValue) => {
    if (!activeToolItem || !currentProvider || !currentTool)
      return
    setToolValue(nextValue)
    const credentialId = normalizeCredentialId(nextValue.credential_id)
    if (isUsingExternalMetadata) {
      const externalMetadata = (metadata || {}) as SkillFileMetadata
      const toolType = currentProvider.type === CollectionType.mcp ? 'mcp' : 'builtin'
      const currentToolMetadata = (externalMetadata.tools || {})[activeToolItem.configId]
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
        ...externalMetadata,
        tools: {
          ...(externalMetadata.tools || {}),
          [activeToolItem.configId]: {
            type: toolType,
            configuration: { fields },
            enabled: currentToolMetadata?.enabled ?? resolvedEnabledByConfigId[activeToolItem.configId] ?? true,
            ...(credentialId ? { credential_id: credentialId } : {}),
          },
        },
      }
      onMetadataChange?.(nextMetadata)
      return
    }
    if (!activeTabId || activeTabId === START_TAB_ID)
      return
    const currentMetaData = (fileMetadata.get(activeTabId) || {}) as SkillFileMetadata
    const toolType = currentProvider.type === CollectionType.mcp ? 'mcp' : 'builtin'
    const currentToolMetadata = (currentMetaData.tools || {})[activeToolItem.configId]
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
      ...currentMetaData,
      tools: {
        ...(currentMetaData.tools || {}),
        [activeToolItem.configId]: {
          type: toolType,
          configuration: { fields },
          enabled: currentToolMetadata?.enabled ?? resolvedEnabledByConfigId[activeToolItem.configId] ?? true,
          ...(credentialId ? { credential_id: credentialId } : {}),
        },
      },
    }
    storeApi.getState().setDraftMetadata(activeTabId, nextMetadata)
    storeApi.getState().pinTab(activeTabId)
  }

  const handleToggleTool = useCallback((configId: string, nextValue: boolean) => {
    setEnabledByConfigId(prev => ({ ...prev, [configId]: nextValue }))
    const applyEnabled = (metadata: SkillFileMetadata | undefined) => {
      const nextMetadata: SkillFileMetadata = {
        ...(metadata || {}),
        tools: {
          ...(metadata?.tools || {}),
        },
      }
      const existing = nextMetadata.tools?.[configId]
      const toolType = existing?.type || (currentProvider?.type === CollectionType.mcp ? 'mcp' : 'builtin')
      if (!nextMetadata.tools)
        nextMetadata.tools = {}
      nextMetadata.tools[configId] = {
        type: toolType,
        configuration: existing?.configuration || { fields: [] },
        enabled: nextValue,
        ...(existing?.credential_id ? { credential_id: existing.credential_id } : {}),
      }
      return nextMetadata
    }
    if (isUsingExternalMetadata) {
      onMetadataChange?.(applyEnabled(metadata as SkillFileMetadata | undefined))
      return
    }
    if (!activeTabId || activeTabId === START_TAB_ID)
      return
    const currentMetadata = fileMetadata.get(activeTabId) as SkillFileMetadata | undefined
    const nextMetadata = applyEnabled(currentMetadata)
    storeApi.getState().setDraftMetadata(activeTabId, nextMetadata)
    storeApi.getState().pinTab(activeTabId)
  }, [activeTabId, currentProvider?.type, fileMetadata, isUsingExternalMetadata, metadata, onMetadataChange, storeApi])

  const renderIcon = () => {
    if (isToolMissing) {
      return (
        <span className="flex size-4 items-center justify-center p-px">
          <span className="i-ri-equalizer-2-line h-[14px] w-[14px] text-text-warning" />
        </span>
      )
    }
    if (!resolvedIcon)
      return null
    const iconNode = (() => {
      if (typeof resolvedIcon === 'string') {
        if (resolvedIcon.startsWith('http') || resolvedIcon.startsWith('/')) {
          return (
            <span
              className="h-[14px] w-[14px] shrink-0 rounded-[4px] bg-cover bg-center"
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
    const hoverIcon = (
      <span
        className={cn(
          'i-ri-equalizer-2-line hidden size-[14px]',
          (needAuthorization || isToolMissing) ? 'text-text-warning' : 'text-text-accent',
          isInteractive && 'group-hover:block',
        )}
      />
    )
    const normalIcon = (
      <span className={cn('flex items-center justify-center', isInteractive && 'group-hover:hidden')}>
        {iconNode}
      </span>
    )
    const iconContent = (
      <span className="flex size-4 items-center justify-center">
        {normalIcon}
        {isInteractive && hoverIcon}
      </span>
    )
    if (!needAuthorization)
      return iconContent
    return (
      <span className="flex size-4 items-center justify-center rounded-[5px] border border-components-panel-border-subtle bg-background-default-dodge">
        {iconContent}
      </span>
    )
  }

  const missingTooltipContent = useMemo(() => {
    if (!isToolMissing)
      return null
    return (
      <div className="rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 shadow-lg backdrop-blur-[10px]">
        <div className="text-text-secondary system-xs-medium">
          {t('skillEditor.toolMissing', { ns: 'workflow' })}
        </div>
        <div className="mt-0.5 text-text-tertiary system-xs-regular">
          <Trans
            i18nKey="skillEditor.toolMissingDesc"
            ns="workflow"
            components={{
              Plugins: <Link href="/plugins?tab=discover" className="text-text-accent" />,
            }}
          />
        </div>
      </div>
    )
  }, [isToolMissing, t])

  const renderProviderHeaderIcon = () => {
    if (!resolvedIcon)
      return null
    if (typeof resolvedIcon === 'string') {
      if (resolvedIcon.startsWith('http') || resolvedIcon.startsWith('/')) {
        return (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-divider-subtle bg-background-default-dodge">
            <span
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${resolvedIcon})` }}
            />
          </span>
        )
      }
      return (
        <AppIcon
          size="large"
          icon={resolvedIcon}
          className="!h-10 !w-10 shrink-0 !rounded-[10px] !border border-divider-subtle bg-background-default-dodge"
        />
      )
    }
    return (
      <AppIcon
        size="large"
        icon={resolvedIcon.content}
        background={resolvedIcon.background}
        className="!h-10 !w-10 shrink-0 !rounded-[10px] !border border-divider-subtle bg-background-default-dodge"
      />
    )
  }

  const toolSettingsContent = currentProvider && currentTool && toolValue && (
    <div className="px-3 pb-2">
      <ToolSettingsSection
        currentProvider={currentProvider}
        currentTool={currentTool}
        value={toolValue}
        onChange={handleToolValueChange}
        nodeId={contextNodeId}
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
        enableVariableReference={useModalValue}
      />
    </div>
  )

  const toolDetailContent = currentProvider && currentTool && toolValue && (
    <div className="flex min-h-full flex-col">
      <ToolHeader
        icon={resolvedIcon}
        providerLabel={currentProvider.label?.[language] || currentProvider.name || providerId}
        toolLabel={toolValue.tool_label || activeToolItem?.toolLabel || currentTool.name}
        description={toolDescriptionText}
        onBack={() => {
          setExpandedToolId(null)
        }}
        backLabel={t('operation.back', { ns: 'common' })}
        onClose={() => {
          setIsSettingOpen(false)
          setExpandedToolId(null)
        }}
      />
      <ToolAuthorizationSection
        currentProvider={currentProvider}
        credentialId={toolValue.credential_id}
        onAuthorizationItemClick={(id) => {
          const credentialId = normalizeCredentialId(id)
          setToolValue(prev => (prev ? { ...prev, credential_id: credentialId } : prev))
          if (activeToolItem)
            handleToolValueChange({ ...(toolValue as ToolValue), credential_id: credentialId })
        }}
        noDivider
      />
      {needAuthorization && (
        <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center px-4 py-6 text-text-tertiary">
          <div className="text-text-tertiary system-xs-regular">
            {t('skillEditor.authorizationRequired', { ns: 'workflow' })}
          </div>
        </div>
      )}
      {toolSettingsContent}
      {readmeEntrance}
    </div>
  )

  const groupListContent = (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-divider-subtle px-4 pb-3 pt-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {renderProviderHeaderIcon()}
            <div className="flex flex-col">
              <span className="text-text-secondary system-md-semibold">{providerLabel}</span>
              {providerAuthor && (
                <span className="text-text-tertiary system-xs-regular">{t('toolGroup.byAuthor', { ns: 'workflow', author: providerAuthor })}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-state-base-hover"
            onClick={(event) => {
              event.stopPropagation()
              setIsSettingOpen(false)
              setExpandedToolId(null)
            }}
          >
            <span className="sr-only">{t('operation.close', { ns: 'common' })}</span>
            <span className="i-ri-close-line h-4 w-4" />
          </button>
        </div>
        {providerDescription && (
          <div className="mt-2 text-text-tertiary system-xs-regular">
            {providerDescription}
          </div>
        )}
      </div>
      <div className="pt-2">
        <ToolAuthorizationSection
          currentProvider={currentProvider}
          credentialId={metadataTools[toolItems[0]?.configId || '']?.credential_id}
          onAuthorizationItemClick={(id) => {
            const credentialId = normalizeCredentialId(id)
            if (!toolItems.length)
              return
            if (activeToolItem && toolValue)
              handleToolValueChange({ ...toolValue, credential_id: credentialId })
            const applyCredential = (metadata: SkillFileMetadata | undefined) => {
              const nextMetadata: SkillFileMetadata = {
                ...(metadata || {}),
                tools: {
                  ...(metadata?.tools || {}),
                },
              }
              toolItems.forEach((item) => {
                const existing = nextMetadata.tools?.[item.configId]
                const toolType = existing?.type || (currentProvider?.type === CollectionType.mcp ? 'mcp' : 'builtin')
                const nextEntry: ToolConfigMetadata = {
                  type: toolType,
                  configuration: existing?.configuration || { fields: [] },
                  ...(existing?.enabled !== undefined ? { enabled: existing.enabled } : {}),
                }
                if (credentialId)
                  nextEntry.credential_id = credentialId
                if (!nextMetadata.tools)
                  nextMetadata.tools = {}
                nextMetadata.tools[item.configId] = nextEntry
              })
              return nextMetadata
            }
            if (isUsingExternalMetadata) {
              onMetadataChange?.(applyCredential(metadata as SkillFileMetadata | undefined))
              return
            }
            if (!activeTabId || activeTabId === START_TAB_ID)
              return
            const currentMetadata = fileMetadata.get(activeTabId) as SkillFileMetadata | undefined
            const nextMetadata = applyCredential(currentMetadata)
            storeApi.getState().setDraftMetadata(activeTabId, nextMetadata)
            storeApi.getState().pinTab(activeTabId)
          }}
          noDivider
        />
        {needAuthorization && (
          <div className="flex min-h-[120px] flex-1 flex-col items-center justify-center px-4 py-6 text-text-tertiary">
            <div className="text-text-tertiary system-xs-regular">
              {t('skillEditor.authorizationRequired', { ns: 'workflow' })}
            </div>
          </div>
        )}
      </div>
      {!needAuthorization && (
        <div className="mt-2 flex flex-col gap-2 border-t border-divider-subtle px-4 pb-4 pt-2">
          <div className="text-text-secondary system-sm-semibold-uppercase">
            {t('toolGroup.actionsEnabled', { ns: 'workflow', num: displayEnabledCount })}
          </div>
          <div className="flex flex-col gap-2">
            {toolItems.map(item => (
              <div
                key={item.configId}
                className={cn(
                  'group cursor-pointer rounded-xl border-[0.5px] border-components-panel-border-subtle px-3 py-2 shadow-xs',
                  'bg-components-panel-item-bg hover:bg-components-panel-on-panel-item-bg-hover',
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-text-secondary system-md-semibold">
                    {item.toolLabel}
                  </div>
                  {item.toolParams?.length
                    ? (
                        <div className="hidden items-center group-hover:flex">
                          <button
                            type="button"
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
                            onClick={() => {
                              setExpandedToolId(item.configId)
                            }}
                          >
                            <span className="i-ri-equalizer-2-line size-3.5" />
                            <span className="system-xs-medium">{t('operation.settings', { ns: 'common' })}</span>
                          </button>
                          <div className="mx-1 h-3 w-px bg-divider-regular"></div>
                        </div>
                      )
                    : null}
                  <div className="pl-1">
                    <Switch
                      size="md"
                      defaultValue={resolvedEnabledByConfigId[item.configId] !== false}
                      onChange={(value) => {
                        handleToggleTool(item.configId, value)
                      }}
                    />
                  </div>
                </div>
                {item.toolDescription && (
                  <div className="mt-1 text-text-tertiary system-xs-regular">
                    {item.toolDescription}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {readmeEntrance}
    </div>
  )

  const groupPanelContent = expandedToolId && toolDetailContent ? toolDetailContent : groupListContent

  return (
    <>
      <span ref={ref} className="inline-flex">
        <Tooltip
          disabled={!isToolMissing}
          offset={4}
          noDecoration
          popupClassName="bg-transparent p-0"
          popupContent={missingTooltipContent}
        >
          <span
            className={cn(
              'inline-flex items-center gap-[2px] rounded-[5px] border px-px py-[1px] shadow-xs',
              isInteractive ? 'group cursor-pointer' : 'cursor-default',
              (needAuthorization || isToolMissing) ? 'border-state-warning-active bg-state-warning-hover' : 'border-state-accent-hover-alt bg-state-accent-hover',
              isSelected && 'border-text-accent',
            )}
            title={providerLabel}
            onMouseDown={() => {
              if (!isInteractive)
                return
              if (!toolItems.length)
                return
              setIsSettingOpen(true)
            }}
          >
            {renderIcon()}
            <span className={cn('max-w-[160px] truncate system-xs-medium', (needAuthorization || isToolMissing) ? 'text-text-warning' : 'text-text-accent')}>
              {isToolMissing ? missingDisplayLabel : providerLabel}
            </span>
            {isToolMissing
              ? (
                  <>
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 text-text-tertiary system-2xs-medium-uppercase">
                      {missingToolCount}
                    </span>
                    <span className="flex h-4 items-center justify-center p-[2px] text-text-warning">
                      <span className="i-ri-alert-fill h-3 w-3" />
                    </span>
                  </>
                )
              : needAuthorization
                ? (
                    <span className="flex h-4 items-center gap-0.5 rounded-[5px] border border-text-warning bg-components-badge-bg-dimm px-1 text-text-warning system-2xs-medium-uppercase">
                      {authBadgeLabel}
                      <span className="i-ri-alert-fill h-3 w-3" />
                    </span>
                  )
                : (
                    <span className="flex h-4 items-center rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1 text-text-accent-secondary system-2xs-medium-uppercase">
                      {displayEnabledCount}
                    </span>
                  )}
          </span>
        </Tooltip>
      </span>
      {useModalValue && (
        <Modal
          isShow={isSettingOpen}
          onClose={() => {
            setIsSettingOpen(false)
            setExpandedToolId(null)
          }}
          className="!max-w-[420px] !bg-transparent !p-0"
          overflowVisible
        >
          <div className={cn('relative min-h-20 w-[420px] overflow-y-auto rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pb-4 shadow-lg backdrop-blur-sm')}>
            {groupPanelContent}
          </div>
        </Modal>
      )}
      {!useModalValue && portalContainer && isSettingOpen && createPortal(
        <div
          className="absolute bottom-4 right-4 top-4 z-[99]"
          data-tool-group-setting-panel="true"
        >
          <div className={cn('relative h-full min-h-20 w-[420px] overflow-y-auto rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pb-4 shadow-lg backdrop-blur-sm')}>
            {groupPanelContent}
          </div>
        </div>,
        portalContainer,
      )}
    </>
  )
}

export default React.memo(ToolGroupBlockComponent)
