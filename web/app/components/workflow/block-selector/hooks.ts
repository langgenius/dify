import {
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  TabsEnum,
  ToolTypeEnum,
} from './types'

export const useTabs = (noBlocks?: boolean, noSources?: boolean, noTools?: boolean) => {
  const { t } = useTranslation()
  const tabs = useMemo(() => {
    return [
      ...(
        noBlocks
          ? []
          : [
            {
              key: TabsEnum.Blocks,
              name: t('workflow.tabs.blocks'),
            },
          ]
      ),
      ...(
        noSources
          ? []
          : [
            {
              key: TabsEnum.Sources,
              name: t('workflow.tabs.sources'),
            },
          ]
      ),
      ...(
        noTools
          ? []
          : [
            {
              key: TabsEnum.Tools,
              name: t('workflow.tabs.tools'),
            },
          ]
      ),
    ]
  }, [t, noBlocks, noSources, noTools])
  const initialTab = useMemo(() => {
    if (noBlocks)
      return noTools ? TabsEnum.Sources : TabsEnum.Tools

    if (noTools)
      return noBlocks ? TabsEnum.Sources : TabsEnum.Blocks

    return TabsEnum.Blocks
  }, [noBlocks, noSources, noTools])
  const [activeTab, setActiveTab] = useState(initialTab)

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
      name: t('workflow.tabs.allTool'),
    },
    {
      key: ToolTypeEnum.BuiltIn,
      name: t('workflow.tabs.plugin'),
    },
    {
      key: ToolTypeEnum.Custom,
      name: t('workflow.tabs.customTool'),
    },
    {
      key: ToolTypeEnum.Workflow,
      name: t('workflow.tabs.workflowTool'),
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
