import type { experimental_RouterUtilsDefaults, RouterUtils } from '@orpc/tanstack-query'
import type { ConsoleClient } from '../index'

export type ConsoleQuery = RouterUtils<ConsoleClient>

/** Shared query and mutation defaults for the console router, keyed by procedure path. */
export type ConsolePolicies = experimental_RouterUtilsDefaults<ConsoleClient>

export type WorkspaceCurrentPolicies = NonNullable<
  NonNullable<ConsolePolicies['workspaces']>['current']
>
