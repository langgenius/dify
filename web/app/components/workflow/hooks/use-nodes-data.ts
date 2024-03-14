import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type { BlockEnum } from '../types'
import {
  NODES_EXTRA_DATA,
  NODES_INITIAL_DATA,
} from '../constants'
import { useStore } from '../store'

export const useNodesInitialData = () => {
  const { t } = useTranslation()
  const nodesDefaultConfigs = useStore(s => s.nodesDefaultConfigs)

  return useMemo(() => produce(NODES_INITIAL_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].title = t(`workflow.blocks.${key}`)

      if (nodesDefaultConfigs[key as BlockEnum]) {
        draft[key as BlockEnum] = {
          ...draft[key as BlockEnum],
          ...nodesDefaultConfigs[key as BlockEnum],
        }
      }
    })
  }), [t, nodesDefaultConfigs])
}

export const useNodesExtraData = () => {
  const { t } = useTranslation()

  return useMemo(() => produce(NODES_EXTRA_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].about = t(`workflow.blocksAbout.${key}`)
    })
  }), [t])
}
