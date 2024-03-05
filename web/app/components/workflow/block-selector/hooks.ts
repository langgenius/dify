import { useTranslation } from 'react-i18next'
import { BLOCKS } from './constants'

export const useBlocks = () => {
  const { t } = useTranslation()

  return BLOCKS.map((block) => {
    return {
      ...block,
      title: t(`workflow.blocks.${block.type}`),
    }
  })
}
