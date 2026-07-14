import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BLOCKS } from './constants'
import { TabType, ToolType } from './types'

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
  defaultActiveTab?: TabType
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
        key: TabType.Blocks,
        name: t(($) => $['tabs.blocks'], { ns: 'workflow' }),
        show: !noBlocks,
      },
      {
        key: TabType.Tools,
        name: t(($) => $['tabs.tools'], { ns: 'workflow' }),
        show: !noTools,
      },
      {
        key: TabType.Sources,
        name: t(($) => $['tabs.sources'], { ns: 'workflow' }),
        show: !noSources,
      },
      {
        key: TabType.Start,
        name: t(($) => $['tabs.start'], { ns: 'workflow' }),
        show: shouldShowStartTab,
        disabled: shouldDisableStartTab,
        disabledTip: shouldDisableStartTab ? startDisabledTip : undefined,
      },
      {
        key: TabType.Snippets,
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
  ])

  const initialTab = useMemo(() => {
    const getValidTabKey = (targetKey?: TabType) => {
      if (!targetKey) return undefined
      const tab = tabs.find((tabItem) => tabItem.key === targetKey)
      if (!tab || tab.disabled) return undefined
      return tab.key
    }
    const preferredDefault = getValidTabKey(defaultActiveTab)
    if (preferredDefault) return preferredDefault

    return tabs.find((tab) => !tab.disabled)?.key ?? TabType.Blocks
  }, [defaultActiveTab, tabs])

  return {
    tabs,
    initialTab,
  }
}

export const useToolTabs = (isHideMCPTools?: boolean) => {
  const { t } = useTranslation()
  const tabs: Array<{ key: ToolType; name: string }> = [
    {
      key: ToolType.All,
      name: t(($) => $['tabs.allTool'], { ns: 'workflow' }),
    },
    {
      key: ToolType.BuiltIn,
      name: t(($) => $['tabs.plugin'], { ns: 'workflow' }),
    },
    {
      key: ToolType.Custom,
      name: t(($) => $['tabs.customTool'], { ns: 'workflow' }),
    },
    {
      key: ToolType.Workflow,
      name: t(($) => $['tabs.workflowTool'], { ns: 'workflow' }),
    },
  ]
  if (!isHideMCPTools) {
    tabs.push({
      key: ToolType.MCP,
      name: 'MCP',
    })
  }

  return tabs
}
