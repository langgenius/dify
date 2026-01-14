import type { SandboxProvider } from '@/types/sandbox-provider'
import { type } from '@orpc/contract'
import { base } from '../base'

export const getSandboxProviderListContract = base
  .route({
    path: '/workspaces/current/sandbox-providers',
    method: 'GET',
  })
  .input(type<unknown>())
  .output(type<SandboxProvider[]>())

export const getSandboxProviderContract = base
  .route({
    path: '/workspaces/current/sandbox-provider/{providerType}',
    method: 'GET',
  })
  .input(type<{
    params: {
      providerType: string
    }
  }>())
  .output(type<SandboxProvider>())

export const saveSandboxProviderConfigContract = base
  .route({
    path: '/workspaces/current/sandbox-provider/{providerType}/config',
    method: 'POST',
  })
  .input(type<{
    params: {
      providerType: string
    }
    body: {
      config: Record<string, string>
    }
  }>())
  .output(type<{ result: string }>())

export const deleteSandboxProviderConfigContract = base
  .route({
    path: '/workspaces/current/sandbox-provider/{providerType}/config',
    method: 'DELETE',
  })
  .input(type<{
    params: {
      providerType: string
    }
  }>())
  .output(type<{ result: string }>())

export const activateSandboxProviderContract = base
  .route({
    path: '/workspaces/current/sandbox-provider/{providerType}/activate',
    method: 'POST',
  })
  .input(type<{
    params: {
      providerType: string
    }
  }>())
  .output(type<{ result: string }>())

export const getActiveSandboxProviderContract = base
  .route({
    path: '/workspaces/current/sandbox-provider/active',
    method: 'GET',
  })
  .input(type<unknown>())
  .output(type<{ provider_type: string | null }>())
