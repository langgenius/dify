import { act, render, screen, within } from '@testing-library/react'
import { consoleQuery } from '@/service/client'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedFeatures,
} from '@/test/console/query-data'
import AnnotationUsage from '../annotation-full/usage'
import Billing from '../billing-page'
import VectorSpaceInfo from '../usage-info/vector-space-info'

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

it('waits for the real billing response instead of presenting a default Sandbox plan', async () => {
  const queryClient = createConsoleQueryClient()
  const { wrapper } = createConsoleQueryWrapper({
    queryClient,
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  render(<Billing />, { wrapper })
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
  const apps = await screen.findByRole('group', { name: 'billing.usagePage.buildApps' })
  expect(within(apps).getByText('17')).toBeInTheDocument()
  expect(within(apps).getByText('50')).toBeInTheDocument()
  expect(screen.getByText('billing.plans.professional.name')).toBeInTheDocument()
})

it('waits for vector-space data and uses its actual limit rather than a static plan limit', async () => {
  const queryClient = createConsoleQueryClient()
  const { wrapper } = createConsoleQueryWrapper({
    queryClient,
    features: { billing: { subscription: { plan: 'professional' } } },
  })
  render(<VectorSpaceInfo />, { wrapper })
  expect(
    screen.queryByRole('group', { name: 'billing.usagePage.vectorSpace' }),
  ).not.toBeInTheDocument()
  await act(async () => {
    queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryKey(), {
      size: 256,
      limit: 900,
      usage_unknown: false,
    })
  })
  const storage = await screen.findByRole('group', { name: 'billing.usagePage.vectorSpace' })
  expect(within(storage).getByText('256')).toBeInTheDocument()
  expect(within(storage).getByText('900MB')).toBeInTheDocument()
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
