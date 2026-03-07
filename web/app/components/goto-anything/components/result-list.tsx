'use client'

import type { FC } from 'react'
import type { SearchResult } from '../actions/types'
import { Command } from 'cmdk'
import { useTranslation } from 'react-i18next'
import ResultItem from './result-item'

export type ResultListProps = {
  groupedResults: Record<string, SearchResult[]>
  onSelect: (result: SearchResult) => void
}

const ResultList: FC<ResultListProps> = ({ groupedResults, onSelect }) => {
  const { t } = useTranslation()

  const getGroupHeading = (type: string) => {
    const typeMap = {
      'app': 'gotoAnything.groups.apps',
      'plugin': 'gotoAnything.groups.plugins',
      'knowledge': 'gotoAnything.groups.knowledgeBases',
      'workflow-node': 'gotoAnything.groups.workflowNodes',
      'command': 'gotoAnything.groups.commands',
    } as const
    return t(typeMap[type as keyof typeof typeMap] || `${type}s`, { ns: 'app' })
  }

  return (
    <>
      {Object.entries(groupedResults).map(([type, results]) => (
        <Command.Group
          key={type}
          heading={getGroupHeading(type)}
          className="p-2 capitalize text-text-secondary"
        >
          {results.map(result => (
            <ResultItem
              key={`${result.type}-${result.id}`}
              result={result}
              onSelect={() => onSelect(result)}
            />
          ))}
        </Command.Group>
      ))}
    </>
  )
}

export default ResultList
