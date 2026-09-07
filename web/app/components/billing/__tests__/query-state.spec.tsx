import { act, render, screen, within } from '@testing-library/react'
import { consoleQuery } from '@/service/client'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedFeatures,
} from '@/test/console/query-data'
import AnnotationUsage from '../annotation-full/usage'
import Billing from '../billing-page'

vi.mock('@/service/base', () => ({
  request: vi.fn(() => new Promise(() => {})),
  sseGeneratorPost: vi.fn(),
}))
vi.mock('../upgrade-btn', () => ({ default: () => null }))
vi.mock('../hooks/use-education-discount', () => ({
  useEducationDiscount: () => ({
    handleEducationDiscount: vi.fn(),
    isEducationDiscountLoading: false,
  }),
}))

it('reveals the plan and all usage together when both billing queries have data', async () => {
  const queryClient = createConsoleQueryClient()
  const { wrapper } = createConsoleQueryWrapper({
    queryClient,
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  render(<Billing />, { wrapper })
  expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  expect(screen.queryByText('billing.plans.sandbox.name')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('group', { name: 'billing.usagePage.buildApps' }),
  ).not.toBeInTheDocument()
  await act(async () => {
    seedFeatures(queryClient, {
      billing: { subscription: { plan: 'professional' } },
      apps: { size: 17, limit: 50 },
    })
  })
  expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  expect(
    screen.queryByRole('group', { name: 'billing.usagePage.buildApps' }),
  ).not.toBeInTheDocument()
  await act(async () => {
    queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryKey(), {
      size: 256,
      limit: 900,
      usage_unknown: false,
    })
  })
  const apps = await screen.findByRole('group', { name: 'billing.usagePage.buildApps' })
  expect(within(apps).getByText('17')).toBeInTheDocument()
  expect(within(apps).getByText('50')).toBeInTheDocument()
  expect(screen.getByText('billing.plans.professional.name')).toBeInTheDocument()
  const storage = screen.getByRole('group', { name: 'billing.usagePage.vectorSpace' })
  expect(within(storage).getByText('256')).toBeInTheDocument()
  expect(within(storage).getByText('900MB')).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: 'appApi.loading' })).not.toBeInTheDocument()
})

it('renders annotation usage only from returned data and preserves zero as an unlimited quota', async () => {
  const queryClient = createConsoleQueryClient()
  const { wrapper } = createConsoleQueryWrapper({ queryClient })
  render(<AnnotationUsage />, { wrapper })
  expect(
    screen.queryByRole('group', { name: 'billing.annotatedResponse.quotaTitle' }),
  ).not.toBeInTheDocument()
  await act(async () => {
    seedFeatures(queryClient, { annotation_quota_limit: { size: 4, limit: 0 } })
  })
  const annotation = await screen.findByRole('group', {
    name: 'billing.annotatedResponse.quotaTitle',
  })
  expect(within(annotation).getByText('4')).toBeInTheDocument()
  expect(within(annotation).getByText('billing.plansCommon.unlimited')).toBeInTheDocument()
})
