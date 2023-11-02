'use client'
import type { FC } from 'react'
import React from 'react'
import RetrivalParamConfig from '../retrival-param-config'
import { RETRIEVE_METHOD } from '@/types/app'
import RadioCard from '@/app/components/base/radio-card'
import { PatternRecognition, Semantic } from '@/app/components/base/icons/src/vender/solid/development'
import { FileSearch02 } from '@/app/components/base/icons/src/vender/solid/files'

type Props = {
  value: RETRIEVE_METHOD
  onChange: (value: RETRIEVE_METHOD) => void
}

const RetrievalMethodConfig: FC<Props> = ({
  value,
  onChange,
}) => {
  return (
    <div className='space-y-2'>
      <RadioCard
        icon={<Semantic className='w-4 h-4 text-[#7839EE]' />}
        title={'Semantic Search'}
        description='Generate query embeddings and search for the text chunk most similar to its vector representation.'
        isChosen={value === RETRIEVE_METHOD.semantic}
        onChosen={() => onChange(RETRIEVE_METHOD.semantic)}
        chosenConfig={
          <RetrivalParamConfig
            type={RETRIEVE_METHOD.semantic}
            value={{}}
            onChange={() => {}}
          />
        }
      />
      <RadioCard
        icon={<FileSearch02 className='w-4 h-4 text-[#7839EE]' />}
        title={'Full-Text Search'}
        description='Generate query embeddings and search for the text chunk most similar to its vector representation.'
        isChosen={value === RETRIEVE_METHOD.fullText}
        onChosen={() => onChange(RETRIEVE_METHOD.fullText)}
        chosenConfig={
          <RetrivalParamConfig
            type={RETRIEVE_METHOD.fullText}
            value={{}}
            onChange={() => {}}
          />
        }
      />
      <RadioCard
        icon={<PatternRecognition className='w-4 h-4 text-[#7839EE]' />}
        title={'Hybrid Search'}
        description='Generate query embeddings and search for the text chunk most similar to its vector representation.'
        isChosen={value === RETRIEVE_METHOD.hybrid}
        onChosen={() => onChange(RETRIEVE_METHOD.hybrid)}
        chosenConfig={
          <RetrivalParamConfig
            type={RETRIEVE_METHOD.hybrid}
            value={value}
            onChange={() => {}}
          />
        }
      />
    </div>
  )
}
export default React.memo(RetrievalMethodConfig)
