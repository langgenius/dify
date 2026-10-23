import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import StatsBar from '../stats-bar'

const stats = (entityTypes: Record<string, number>) => ({
  entity_count: 5,
  relation_count: 4,
  entity_types: entityTypes,
  failed_chunk_count: 0,
  last_error: null,
  last_failed_at: null,
  building: false,
})

describe('StatsBar', () => {
  it('lists entity types from most to least common', () => {
    render(<StatsBar stats={stats({ PERSON: 1, ORGANIZATION: 3, LOCATION: 1 })} />)

    const types = screen
      .getAllByText(/^(PERSON|ORGANIZATION|LOCATION)$/)
      .map((node) => node.textContent)
    expect(types[0]).toBe('ORGANIZATION')
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('leaves out the breakdown when no entity has a type yet', () => {
    render(<StatsBar stats={stats({})} />)

    expect(screen.queryByText(/graph\.entityTypes/)).not.toBeInTheDocument()
  })

  it('reads as zero before the stats arrive', () => {
    render(<StatsBar />)

    expect(screen.getAllByText('0')).toHaveLength(2)
    expect(screen.queryByText(/graph\.entityTypes/)).not.toBeInTheDocument()
  })
})
