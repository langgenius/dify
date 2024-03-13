import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type { BlockEnum } from '../types'
import {
  NODES_EXTRA_DATA,
  NODES_INITIAL_DATA,
} from '../constants'

export const useNodesInitialData = () => {
  const { t } = useTranslation()

  return produce(NODES_INITIAL_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].title = t(`workflow.blocks.${key}`)
    })
  })
}

export const useNodesExtraData = () => {
  const { t } = useTranslation()

  return produce(NODES_EXTRA_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].about = t(`workflow.blocksAbout.${key}`)
    })
  })
}
