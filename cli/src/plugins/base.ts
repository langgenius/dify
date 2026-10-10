import type { BuildContext } from '@/kernel/plugin'
import { catalog } from './catalog'
import { config } from './config'
import { env } from './env'
import { globalFlags } from './global-flags'
import { http } from './http'
import { io } from './io'
import { ops } from './ops'
import { session } from './session'
import { token } from './token'

// What a command may reach through `ctx.get`. `needs` is a compile-time allow-list,
// never a load list: a plugin builds only when something asks for it, so a command
// pays for exactly the plugins it calls. A new plugin commands should see goes here.
export const BASE_PLUGINS = [
  globalFlags,
  env,
  config,
  session,
  token,
  catalog,
  http,
  ops,
  io,
] as const

export type CommandContext = BuildContext<(typeof BASE_PLUGINS)[number]>
