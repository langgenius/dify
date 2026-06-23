import { fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { DeploymentsNav } from '../index'

const mockPush = vi.hoisted(() => vi.fn())
const mockFetchNextPage = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/app/components/header/nav', () => ({
  default: ({
    createText,
    curNav,
    isLoadingMore,
    navigationItems,
    onCreate,
    onLoadMore,
    text,
  }: {
    createText: string
    curNav?: { name: string }
    isLoadingMore: boolean
    navigationItems: Array<{ name: string }>
    onCreate: () => void
    onLoadMore: () => void
    text: string
  }) => (
    <nav aria-label={text}>
      <span>{curNav?.name}</span>
      {navigationItems.map(item => (
        <span key={item.name}>{item.name}</span>
      ))}
      <button type="button" onClick={onCreate}>
        {createText}
      </button>
      <button type="button" data-loading={String(isLoadingMore)} onClick={onLoadMore}>
        load more
      </button>
    </nav>
  ),
}))

vi.mock('../state', () => ({
  deploymentsNavCurrentItemAtom: atom({
    id: 'app-instance-1',
    name: 'Deployment 1',
  }),
  deploymentsNavItemsAtom: atom([
    {
      id: 'app-instance-1',
      name: 'Deployment 1',
    },
  ]),
  deploymentsNavListQueryAtom: atom({
    fetchNextPage: mockFetchNextPage,
    hasNextPage: true,
    isFetchingNextPage: false,
  }),
}))

describe('DeploymentsNav', () => {
  it('should render deployment navigation from atom state and forward nav actions', () => {
    render(<DeploymentsNav />)

    expect(screen.getByRole('navigation', { name: 'common.menus.deployments' })).toBeInTheDocument()
    expect(screen.getAllByText('Deployment 1')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'deployments:list.createDeployment' }))
    fireEvent.click(screen.getByRole('button', { name: 'load more' }))

    expect(mockPush).toHaveBeenCalledWith('/deployments/create')
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })
})
