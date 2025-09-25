import {
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
// import { BLOCKS, START_BLOCKS } from './constants'
import {
  TabsEnum,
  ToolTypeEnum,
} from './types'

// export const useBlocks = () => {
//   const { t } = useTranslation()

//   return BLOCKS.map((block) => {
//     return {
//       ...block,
//       title: t(`workflow.blocks.${block.type}`),
//     }
//   })
// }

// export const useStartBlocks = () => {
//   const { t } = useTranslation()

//   return START_BLOCKS.map((block) => {
//     return {
//       ...block,
//       title: t(`workflow.blocks.${block.type}`),
//     }
//   })
// }

export const useTabs = ({ noBlocks, noSources, noTools, noStart = true }: {
  noBlocks?: boolean
  noSources?: boolean
  noTools?: boolean
  noStart?: boolean
}) => {
  const { t } = useTranslation()
  const tabs = useMemo(() => {
    return [{
      key: TabsEnum.Blocks,
      name: t('workflow.tabs.blocks'),
      show: !noBlocks,
    }, {
      key: TabsEnum.Sources,
      name: t('workflow.tabs.sources'),
      show: !noSources,
    }, {
      key: TabsEnum.Tools,
      name: t('workflow.tabs.tools'),
      show: !noTools,
    },
    {
      key: TabsEnum.Start,
      name: t('workflow.tabs.start'),
      show: !noStart,
    }].filter(tab => tab.show)
  }, [t, noBlocks, noSources, noTools, noStart])

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
