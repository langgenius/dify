import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import type { ChunkStructureEnum } from '../../types'
import OptionCard from '../option-card'
import Selector from './selector'
import { useChunkStructure } from './hooks'

type ChunkStructureProps = {
  chunkStructure: ChunkStructureEnum
  onChunkStructureChange: (value: ChunkStructureEnum) => void
  readonly?: boolean
}
const ChunkStructure = ({
  chunkStructure,
  onChunkStructureChange,
  readonly = false,
}: ChunkStructureProps) => {
  const { t } = useTranslation()
  const {
    options,
    optionMap,
  } = useChunkStructure()

  return (
    <Field
      fieldTitleProps={{
        title: t('workflow.nodes.knowledgeBase.chunkStructure'),
        tooltip: t('workflow.nodes.knowledgeBase.chunkStructure'),
        operation: (
          <Selector
            options={options}
            value={chunkStructure}
            onChange={onChunkStructureChange}
            readonly={readonly}
          />
        ),
      }}
    >
      <OptionCard
        {...optionMap[chunkStructure]}
        selectedId={chunkStructure}
        enableSelect={false}
        enableHighlightBorder={false}
      />
    </Field>
  )
}

export default memo(ChunkStructure)
