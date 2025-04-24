import { useTranslation } from 'react-i18next'
import {
  TabsEnum,
  ToolTypeEnum,
} from './types'

export const useTabs = () => {
  const { t } = useTranslation()

  return [
    {
      key: TabsEnum.Blocks,
      name: t('workflow.tabs.blocks'),
    },
    {
      key: TabsEnum.Tools,
      name: t('workflow.tabs.tools'),
    },
  ]
}

export const useToolTabs = () => {
  const { t } = useTranslation()

  return [
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
}
