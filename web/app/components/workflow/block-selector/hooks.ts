import { useTranslation } from 'react-i18next'
import { BLOCKS } from './constants'
import { TabsEnum } from './types'

export const useBlocks = () => {
  const { t } = useTranslation()

  return BLOCKS.map((block) => {
    return {
      ...block,
      title: t(`workflow.blocks.${block.type}`),
    }
  })
}

export const useTabs = () => {
  const { t } = useTranslation()

  return [
    {
      key: TabsEnum.Blocks,
      name: t('workflow.tabs.blocks'),
    },
    {
      key: TabsEnum.BuiltInTool,
      name: t('workflow.tabs.builtInTool'),
    },
    {
      key: TabsEnum.CustomTool,
      name: t('workflow.tabs.customTool'),
    },
  ]
}
