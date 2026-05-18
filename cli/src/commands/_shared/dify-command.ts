import type { AuthedContext, AuthedContextOptions } from './authed-command.js'
import { Command } from '../../framework/command.js'
import { buildAuthedContext } from './authed-command.js'

export abstract class DifyCommand extends Command {
  protected outputFormat = ''

  protected async authedCtx(opts: AuthedContextOptions): Promise<AuthedContext> {
    this.outputFormat = opts.format ?? ''

    return buildAuthedContext(this, opts)
  }
}
