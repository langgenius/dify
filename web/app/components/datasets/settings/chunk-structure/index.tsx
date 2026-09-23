import type { ChunkingMode } from '@/models/datasets'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import OptionCard from '../option-card'
import { useChunkStructure } from './hooks'

type ChunkStructureProps = {
  chunkStructure: ChunkingMode
}

const ChunkStructure = ({ chunkStructure }: ChunkStructureProps) => {
  const { t } = useTranslation()
  const { options } = useChunkStructure()

  return (
    <RadioGroup<ChunkingMode>
      aria-label={t(($) => $['form.chunkStructure.title'], { ns: 'datasetSettings' })}
      value={chunkStructure}
      disabled
      className="flex flex-col items-stretch gap-x-0 gap-y-1"
    >
      {options.map((option) => (
        <OptionCard
          key={option.id}
          id={option.id}
          icon={option.icon}
          iconActiveColor={option.iconActiveColor}
          title={option.title}
          description={option.description}
          isActive={chunkStructure === option.id}
          effectColor={option.effectColor}
          showEffectColor
          className="gap-x-1.5 p-3 pr-4"
          disabled
        />
      ))}
    </RadioGroup>
  )
}

export default React.memo(ChunkStructure)
