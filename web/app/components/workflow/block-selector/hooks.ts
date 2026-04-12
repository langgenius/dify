import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useSnippetAndEvaluationPlanAccess } from '@/hooks/use-snippet-and-evaluation-plan-access'
import { BLOCKS } from './constants'
import {
  TabsEnum,
  ToolTypeEnum,
} from './types'

export const useBlocks = () => {
  const { t } = useTranslation()

  return BLOCKS.map((block) => {
    return {
      ...block,
      title: t(`blocks.${block.type}`, { ns: 'workflow' }),
    }
  })
}

export const useTabs = ({
  noBlocks,
  noSources,
  noTools,
  noStart = true,
  defaultActiveTab,
  hasUserInputNode = false,
  disableStartTab = false,
  forceEnableStartTab = false, // When true, Start tab remains enabled even if trigger/user input nodes already exist.
}: {
  noBlocks?: boolean
  noSources?: boolean
  noTools?: boolean
  noStart?: boolean
  defaultActiveTab?: TabsEnum
  hasUserInputNode?: boolean
  disableStartTab?: boolean
  forceEnableStartTab?: boolean
}) => {
  const { t } = useTranslation()
  const { canAccess: canAccessSnippetsAndEvaluation } = useSnippetAndEvaluationPlanAccess()
  const shouldShowStartTab = !noStart
  const shouldDisableStartTab = disableStartTab || (!forceEnableStartTab && hasUserInputNode)
  const startDisabledTip = disableStartTab
    ? t('tabs.startNotSupportedTip', { ns: 'workflow' })
    : t('tabs.startDisabledTip', { ns: 'workflow' })
  const tabs = useMemo(() => {
    const tabConfigs = [{
      key: TabsEnum.Blocks,
      name: t('tabs.blocks', { ns: 'workflow' }),
      show: !noBlocks,
    }, {
      key: TabsEnum.Sources,
      name: t('tabs.sources', { ns: 'workflow' }),
      show: !noSources,
    }, {
      key: TabsEnum.Tools,
      name: t('tabs.tools', { ns: 'workflow' }),
      show: !noTools,
    }, {
      key: TabsEnum.Start,
      name: t('tabs.start', { ns: 'workflow' }),
      show: shouldShowStartTab,
      disabled: shouldDisableStartTab,
      disabledTip: shouldDisableStartTab ? startDisabledTip : undefined,
    }, {
      key: TabsEnum.Snippets,
      name: t('tabs.snippets', { ns: 'workflow' }),
      show: canAccessSnippetsAndEvaluation,
    }]

    return tabConfigs.filter(tab => tab.show)
  }, [canAccessSnippetsAndEvaluation, t, noBlocks, noSources, noTools, shouldShowStartTab, shouldDisableStartTab, startDisabledTip])

  const getValidTabKey = useCallback((targetKey?: TabsEnum) => {
    if (!targetKey)
      return undefined
    const tab = tabs.find(tabItem => tabItem.key === targetKey)
    if (!tab || tab.disabled)
      return undefined
    return tab.key
  }, [tabs])

  const initialTab = useMemo(() => {
    const fallbackTab = tabs.find(tab => !tab.disabled)?.key ?? TabsEnum.Blocks
    const preferredDefault = getValidTabKey(defaultActiveTab)
    if (preferredDefault)
      return preferredDefault

    const preferredOrder: TabsEnum[] = []
    if (!noBlocks)
      preferredOrder.push(TabsEnum.Blocks)
    if (!noTools)
      preferredOrder.push(TabsEnum.Tools)
    if (!noSources)
      preferredOrder.push(TabsEnum.Sources)
    if (!noStart)
      preferredOrder.push(TabsEnum.Start)
    preferredOrder.push(TabsEnum.Snippets)

    for (const tabKey of preferredOrder) {
      const validKey = getValidTabKey(tabKey)
      if (validKey)
        return validKey
    }

    return fallbackTab
  }, [defaultActiveTab, noBlocks, noSources, noTools, noStart, tabs, getValidTabKey])
  const [activeTab, setActiveTab] = useState(initialTab)

  useEffect(() => {
    const currentTab = tabs.find(tab => tab.key === activeTab)
    if (!currentTab || currentTab.disabled)
      setActiveTab(initialTab)
  }, [tabs, activeTab, initialTab])

  return {
    tabs,
    activeTab,
    setActiveTab,
  }
}

export const useToolTabs = (isHideMCPTools?: boolean) => {
  const { t } = useTranslation()
  const tabs = [
    {
      key: ToolTypeEnum.All,
      name: t('tabs.allTool', { ns: 'workflow' }),
    },
    {
      key: ToolTypeEnum.BuiltIn,
      name: t('tabs.plugin', { ns: 'workflow' }),
    },
    {
      key: ToolTypeEnum.Custom,
      name: t('tabs.customTool', { ns: 'workflow' }),
    },
    {
      key: ToolTypeEnum.Workflow,
      name: t('tabs.workflowTool', { ns: 'workflow' }),
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
