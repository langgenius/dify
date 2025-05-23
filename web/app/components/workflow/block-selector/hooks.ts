import {
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useDataSourceList } from '@/service/use-pipeline'
import { useStore } from '../store'
import {
  TabsEnum,
  ToolTypeEnum,
} from './types'

export const useTabs = (noBlocks?: boolean, noSources?: boolean) => {
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
      {
        key: TabsEnum.Tools,
        name: t('workflow.tabs.tools'),
      },
    ]
  }, [t, noBlocks, noSources])
  const initialTab = useMemo(() => {
    if (noBlocks)
      return TabsEnum.Sources

    return TabsEnum.Blocks
  }, [noBlocks])
  const [activeTab, setActiveTab] = useState(initialTab)

  return {
    tabs,
    activeTab,
    setActiveTab,
  }
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

export const useDataSources = () => {
  const pipelineId = useStore(s => s.pipelineId)
  const { data: dataSourceList } = useDataSourceList(!!pipelineId)

  return dataSourceList || []
}
