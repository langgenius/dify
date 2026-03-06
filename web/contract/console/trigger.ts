import type {
  TriggerLogEntity,
  TriggerOAuthClientParams,
  TriggerOAuthConfig,
  TriggerProviderApiEntity,
  TriggerSubscription,
  TriggerSubscriptionBuilder,
} from '@/app/components/workflow/block-selector/types'
import { type } from '@orpc/contract'
import { base } from '../base'

export const triggersContract = base
  .route({ path: '/workspaces/current/triggers', method: 'GET' })
  .input(type<{ query?: { type?: string } }>())
  .output(type<TriggerProviderApiEntity[]>())

export const triggerProviderInfoContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/info', method: 'GET' })
  .input(type<{ params: { provider: string } }>())
  .output(type<TriggerProviderApiEntity>())

export const triggerSubscriptionsContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/subscriptions/list', method: 'GET' })
  .input(type<{ params: { provider: string } }>())
  .output(type<TriggerSubscription[]>())

export const triggerSubscriptionBuilderCreateContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/subscriptions/builder/create', method: 'POST' })
  .input(type<{
    params: { provider: string }
    body?: { credential_type?: string }
  }>())
  .output(type<{ subscription_builder: TriggerSubscriptionBuilder }>())

export const triggerSubscriptionBuilderUpdateContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/subscriptions/builder/update/{subscriptionBuilderId}', method: 'POST' })
  .input(type<{
    params: { provider: string, subscriptionBuilderId: string }
    body?: {
      name?: string
      properties?: Record<string, unknown>
      parameters?: Record<string, unknown>
      credentials?: Record<string, unknown>
    }
  }>())
  .output(type<TriggerSubscriptionBuilder>())

export const triggerSubscriptionBuilderVerifyUpdateContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/subscriptions/builder/verify-and-update/{subscriptionBuilderId}', method: 'POST' })
  .input(type<{
    params: { provider: string, subscriptionBuilderId: string }
    body?: { credentials?: Record<string, unknown> }
  }>())
  .output(type<{ verified: boolean }>())

export const triggerSubscriptionVerifyContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/subscriptions/verify/{subscriptionId}', method: 'POST' })
  .input(type<{
    params: { provider: string, subscriptionId: string }
    body?: { credentials?: Record<string, unknown> }
  }>())
  .output(type<{ verified: boolean }>())

export const triggerSubscriptionBuildContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/subscriptions/builder/build/{subscriptionBuilderId}', method: 'POST' })
  .input(type<{
    params: { provider: string, subscriptionBuilderId: string }
    body?: {
      name?: string
      parameters?: Record<string, unknown>
    }
  }>())
  .output(type<unknown>())

export const triggerSubscriptionDeleteContract = base
  .route({ path: '/workspaces/current/trigger-provider/{subscriptionId}/subscriptions/delete', method: 'POST' })
  .input(type<{ params: { subscriptionId: string } }>())
  .output(type<{ result: string }>())

export const triggerSubscriptionUpdateContract = base
  .route({ path: '/workspaces/current/trigger-provider/{subscriptionId}/subscriptions/update', method: 'POST' })
  .input(type<{
    params: { subscriptionId: string }
    body?: {
      name?: string
      properties?: Record<string, unknown>
      parameters?: Record<string, unknown>
      credentials?: Record<string, unknown>
    }
  }>())
  .output(type<{ result: string, id: string }>())

export const triggerSubscriptionBuilderLogsContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/subscriptions/builder/logs/{subscriptionBuilderId}', method: 'GET' })
  .input(type<{ params: { provider: string, subscriptionBuilderId: string } }>())
  .output(type<{ logs: TriggerLogEntity[] }>())

export const triggerOAuthConfigContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/oauth/client', method: 'GET' })
  .input(type<{ params: { provider: string } }>())
  .output(type<TriggerOAuthConfig>())

export const triggerOAuthConfigureContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/oauth/client', method: 'POST' })
  .input(type<{
    params: { provider: string }
    body: { client_params?: TriggerOAuthClientParams, enabled: boolean }
  }>())
  .output(type<{ result: string }>())

export const triggerOAuthDeleteContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/oauth/client', method: 'DELETE' })
  .input(type<{ params: { provider: string } }>())
  .output(type<{ result: string }>())

export const triggerOAuthInitiateContract = base
  .route({ path: '/workspaces/current/trigger-provider/{provider}/subscriptions/oauth/authorize', method: 'GET' })
  .input(type<{ params: { provider: string } }>())
  .output(type<{ authorization_url: string, subscription_builder: TriggerSubscriptionBuilder }>())
