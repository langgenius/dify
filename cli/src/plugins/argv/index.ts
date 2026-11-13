import { definePlugin } from '@/kernel/plugin'
import { argv as processArgv } from '@/sys'

export type ArgvService = readonly string[]

export const argv = definePlugin({
  name: 'argv',
  needs: [],
  build: (): ArgvService => processArgv(),
})
