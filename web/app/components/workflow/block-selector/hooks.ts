import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BLOCKS } from './constants'
import { TabsEnum, ToolTypeEnum } from './types'

const startNodesDocsTipLinkKey = 'startNodesDocs' as const

export const useBlocks = () => {
  const { t } = useTranslation()

  return BLOCKS.map((block) => {
    return {
      ...block,
      title: t(($) => $[`blocks.${block.type}`], { ns: 'workflow' }),
    }
  })
}

export const useTabs = ({
  noBlocks,
  noSources,
  noTools,
  noSnippets,
  noStart = true,
  defaultActiveTab,
  hasStartPlaceholderNode = false,
  disableStartTab = false,
  forceEnableStartTab = false, // When true, Start tab remains enabled even if trigger/user input nodes already exist.
}: {
  noBlocks?: boolean
  noSources?: boolean
  noTools?: boolean
  noSnippets?: boolean
  noStart?: boolean
  defaultActiveTab?: TabsEnum
  hasStartPlaceholderNode?: boolean
  disableStartTab?: boolean
  forceEnableStartTab?: boolean
}) => {
  const { t } = useTranslation()
  const shouldShowStartTab = !noStart
  const shouldDisableStartTab = disableStartTab || (!forceEnableStartTab && hasStartPlaceholderNode)
  const startDisabledTip: ReactNode = disableStartTab
    ? t(($) => $['tabs.startNotSupportedTip'], { ns: 'workflow' })
    : hasStartPlaceholderNode
      ? t(($) => $['tabs.unconfiguredStartDisabledTip'], { ns: 'workflow' })
      : t(($) => $['tabs.startDisabledTip'], { ns: 'workflow' })
  const tabs = useMemo(() => {
    const tabConfigs = [
      {
        key: TabsEnum.Blocks,
        name: t(($) => $['tabs.blocks'], { ns: 'workflow' }),
        show: !noBlocks,
      },
      {
        key: TabsEnum.Sources,
        name: t(($) => $['tabs.sources'], { ns: 'workflow' }),
        show: !noSources,
      },
      {
        key: TabsEnum.Tools,
        name: t(($) => $['tabs.tools'], { ns: 'workflow' }),
        show: !noTools,
      },
      {
        key: TabsEnum.Start,
        name: t(($) => $['tabs.start'], { ns: 'workflow' }),
        show: shouldShowStartTab,
        disabled: shouldDisableStartTab,
        disabledTip: shouldDisableStartTab ? startDisabledTip : undefined,
        disabledTipLinkKey:
          shouldDisableStartTab && !disableStartTab && hasStartPlaceholderNode
            ? startNodesDocsTipLinkKey
            : undefined,
      },
      {
        key: TabsEnum.Snippets,
        name: t(($) => $['tabs.snippets'], { ns: 'workflow' }),
        show: !noSnippets,
      },
    ]

    return tabConfigs.filter((tab) => tab.show)
  }, [
    t,
    noBlocks,
    noSources,
    noTools,
    noSnippets,
    shouldShowStartTab,
    shouldDisableStartTab,
    startDisabledTip,
    disableStartTab,
    hasStartPlaceholderNode,
  ])

  const getValidTabKey = useCallback(
    (targetKey?: TabsEnum) => {
      if (!targetKey) return undefined
      const tab = tabs.find((tabItem) => tabItem.key === targetKey)
      if (!tab || tab.disabled) return undefined
      return tab.key
    },
    [tabs],
  )

  const initialTab = useMemo(() => {
    const fallbackTab = tabs.find((tab) => !tab.disabled)?.key ?? TabsEnum.Blocks
    const preferredDefault = getValidTabKey(defaultActiveTab)
    if (preferredDefault) return preferredDefault

    const preferredOrder: TabsEnum[] = []
    if (!noBlocks) preferredOrder.push(TabsEnum.Blocks)
    if (!noTools) preferredOrder.push(TabsEnum.Tools)
    if (!noSources) preferredOrder.push(TabsEnum.Sources)
    if (!noStart) preferredOrder.push(TabsEnum.Start)
    if (!noSnippets) preferredOrder.push(TabsEnum.Snippets)

    for (const tabKey of preferredOrder) {
      const validKey = getValidTabKey(tabKey)
      if (validKey) return validKey
    }

    return fallbackTab
  }, [defaultActiveTab, noBlocks, noSources, noTools, noSnippets, noStart, tabs, getValidTabKey])
  const [activeTab, setActiveTab] = useState(initialTab)
  const resetActiveTab = useCallback(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    const currentTab = tabs.find((tab) => tab.key === activeTab)
    if (!currentTab || currentTab.disabled) resetActiveTab()
  }, [tabs, activeTab, resetActiveTab])

  return {
    tabs,
    activeTab,
    setActiveTab,
    resetActiveTab,
  }
}

export const useToolTabs = (isHideMCPTools?: boolean) => {
  const { t } = useTranslation()
  const tabs = [
    {
      key: ToolTypeEnum.All,
      name: t(($) => $['tabs.allTool'], { ns: 'workflow' }),
    },
    {
      key: ToolTypeEnum.BuiltIn,
      name: t(($) => $['tabs.plugin'], { ns: 'workflow' }),
    },
    {
      key: ToolTypeEnum.Custom,
      name: t(($) => $['tabs.customTool'], { ns: 'workflow' }),
    },
    {
      key: ToolTypeEnum.Workflow,
      name: t(($) => $['tabs.workflowTool'], { ns: 'workflow' }),
    },
  ]
  if (!isHideMCPTools) {
    tabs.push({
      key: ToolTypeEnum.MCP,
      name: 'MCP',
    })
  }

  return tabs
}
