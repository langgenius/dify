import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import PublicV2Page from '../form-v2/[token]/page'
import ConsolePage from '../human-input/[formToken]/page'

const config = vi.hoisted(() => ({ enabled: false, publicForm: vi.fn(), consoleForm: vi.fn() }))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return config.enabled
  },
}))
vi.mock('@/next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('../form-v2/[token]/form', () => ({
  default: () => {
    config.publicForm()
    return <div>Public V2 form</div>
  },
}))
vi.mock('@/features/human-input/console/form', () => ({
  default: () => {
    config.consoleForm()
    return <div>Console V2 form</div>
  },
}))
vi.mock('@/app/(commonLayout)/hydration-boundary', () => ({
  CommonLayoutHydrationBoundary: ({ children }: { children: ReactNode }) => children,
}))

beforeEach(() => {
  config.enabled = false
})

it('blocks the public V2 route before mounting its form when disabled', () => {
  expect(() => render(<PublicV2Page />)).toThrow('NEXT_NOT_FOUND')
  expect(config.publicForm).not.toHaveBeenCalled()
})
it('blocks the Console V2 route before mounting its form when disabled', async () => {
  await expect(ConsolePage({ params: Promise.resolve({ formToken: 'token' }) })).rejects.toThrow(
    'NEXT_NOT_FOUND',
  )
  expect(config.consoleForm).not.toHaveBeenCalled()
})
it('allows both V2 route owners when enabled', async () => {
  config.enabled = true
  render(<PublicV2Page />)
  render(await ConsolePage({ params: Promise.resolve({ formToken: 'token' }) }))
  expect(screen.getByText('Public V2 form')).toBeInTheDocument()
  expect(screen.getByText('Console V2 form')).toBeInTheDocument()
})
