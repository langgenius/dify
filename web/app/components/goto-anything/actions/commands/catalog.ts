import { ENABLE_FEATURE_PREVIEW } from '@/config'
import { accountCommand } from './account'
import { createCommand } from './create'
import { discordCommand } from './discord'
import { docsCommand } from './docs'
import { goCommand } from './go'
import { languageCommand } from './language'
import { modelsCommand } from './models'
import { refineCommand } from './refine'
import { SlashCommandRegistry } from './registry'
import { themeCommand } from './theme'

export const slashCommandRegistry = new SlashCommandRegistry([
  themeCommand,
  languageCommand,
  docsCommand,
  discordCommand,
  modelsCommand,
  accountCommand,
  goCommand,
  ...(ENABLE_FEATURE_PREVIEW ? [createCommand, refineCommand] : []),
])
