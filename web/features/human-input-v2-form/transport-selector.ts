import type { HumanInputV2FormTransport } from './types'
import { createMockHumanInputV2FormTransport } from './mock-transport'
import { realHumanInputV2FormTransport } from './real-transport'

export type HumanInputV2AdapterKind = 'real' | 'mock'

type SelectTransportOptions = {
  adapter: HumanInputV2AdapterKind
  environment: 'development' | 'test' | 'production'
  mockTransport?: HumanInputV2FormTransport
  realTransport?: HumanInputV2FormTransport
}

export const selectHumanInputV2FormTransport = ({
  adapter,
  environment,
  mockTransport = createMockHumanInputV2FormTransport(),
  realTransport = realHumanInputV2FormTransport,
}: SelectTransportOptions): HumanInputV2FormTransport => {
  if (adapter === 'mock' && environment !== 'production') return mockTransport
  return realTransport
}

const runtimeEnvironment = process.env.NODE_ENV

export const defaultHumanInputV2FormTransport = selectHumanInputV2FormTransport({
  adapter: runtimeEnvironment === 'production' ? 'real' : 'mock',
  environment: runtimeEnvironment,
})
