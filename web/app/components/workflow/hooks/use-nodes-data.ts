import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type { BlockEnum } from '../types'
import {
  NODES_EXTRA_DATA,
  NODES_INITIAL_DATA,
} from '../constants'
import { useIsChatMode } from './use-workflow'

export const useNodesInitialData = () => {
  const { t } = useTranslation()

  return useMemo(() => produce(NODES_INITIAL_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].title = t(`workflow.blocks.${key}`)
    })
  }), [t])
}

export const useNodesExtraData = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()

  return useMemo(() => produce(NODES_EXTRA_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].about = t(`workflow.blocksAbout.${key}`)
      draft[key as BlockEnum].availablePrevNodes = draft[key as BlockEnum].getAvailablePrevNodes(isChatMode)
      draft[key as BlockEnum].availableNextNodes = draft[key as BlockEnum].getAvailableNextNodes(isChatMode)
    })
  }), [t, isChatMode])
}
