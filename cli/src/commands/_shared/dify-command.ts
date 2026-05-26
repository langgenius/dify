import type { AuthedContext, AuthedContextOptions } from './authed-command.js'
import { Command } from '../../framework/command.js'
import { buildAuthedContext } from './authed-command.js'

export abstract class DifyCommand extends Command {
  protected async authedCtx(opts: AuthedContextOptions): Promise<AuthedContext> {
    return buildAuthedContext(this, opts)
  }
}
