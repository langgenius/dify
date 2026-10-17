import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import EntityList from '../entity-list'

const entity = (id: string, displayName: string, frequency: number) => ({
  id,
  name: displayName.toLowerCase(),
  display_name: displayName,
  entity_type: 'ORGANIZATION',
  description: '',
  frequency,
})

describe('EntityList', () => {
  it('lists the most mentioned entities first', () => {
    render(<EntityList entities={[entity('e1', 'Globex', 1), entity('e2', 'Acme', 4)]} />)

    const names = screen.getAllByRole('button').map((button) => button.textContent)
    expect(names[0]).toContain('Acme')
    expect(names[1]).toContain('Globex')
  })

  it('focuses the graph on the entity that was clicked', () => {
    const onEntityClick = vi.fn()
    const acme = entity('e2', 'Acme', 4)
    render(<EntityList entities={[acme]} onEntityClick={onEntityClick} />)

    fireEvent.click(screen.getByRole('button', { name: /Acme/ }))

    expect(onEntityClick).toHaveBeenCalledWith(acme)
  })
})
