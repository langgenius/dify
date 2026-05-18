import type { CommandTree } from '../framework/registry.js'
import DevicesList from './auth/devices/list/index.js'
import DevicesRevoke from './auth/devices/revoke/index.js'
import Login from './auth/login/index.js'
import Logout from './auth/logout/index.js'
import Status from './auth/status/index.js'
import Use from './auth/use/index.js'
import Whoami from './auth/whoami/index.js'
import ConfigGet from './config/get/index.js'
import ConfigPath from './config/path/index.js'
import ConfigSet from './config/set/index.js'
import ConfigUnset from './config/unset/index.js'
import ConfigView from './config/view/index.js'
import DescribeApp from './describe/app/index.js'
import EnvList from './env/list/index.js'
import GetApp from './get/app/index.js'
import GetWorkspace from './get/workspace/index.js'
import HelpAccount from './help/account/index.js'
import HelpEnvironment from './help/environment/index.js'
import HelpExternal from './help/external/index.js'
import RunApp from './run/app/index.js'
import RunAppResume from './run/app/resume/index.js'
import Version from './version/index.js'

export const commandTree: CommandTree = {
  auth: {
    subcommands: {
      login: { command: Login, subcommands: {} },
      logout: { command: Logout, subcommands: {} },
      status: { command: Status, subcommands: {} },
      use: { command: Use, subcommands: {} },
      whoami: { command: Whoami, subcommands: {} },
      devices: {
        subcommands: {
          list: { command: DevicesList, subcommands: {} },
          revoke: { command: DevicesRevoke, subcommands: {} },
        },
      },
    },
  },
  config: {
    subcommands: {
      get: { command: ConfigGet, subcommands: {} },
      set: { command: ConfigSet, subcommands: {} },
      unset: { command: ConfigUnset, subcommands: {} },
      view: { command: ConfigView, subcommands: {} },
      path: { command: ConfigPath, subcommands: {} },
    },
  },
  describe: {
    subcommands: {
      app: { command: DescribeApp, subcommands: {} },
    },
  },
  env: {
    subcommands: {
      list: { command: EnvList, subcommands: {} },
    },
  },
  get: {
    subcommands: {
      app: { command: GetApp, subcommands: {} },
      workspace: { command: GetWorkspace, subcommands: {} },
    },
  },
  help: {
    subcommands: {
      account: { command: HelpAccount, subcommands: {} },
      environment: { command: HelpEnvironment, subcommands: {} },
      external: { command: HelpExternal, subcommands: {} },
    },
  },
  run: {
    subcommands: {
      app: {
        command: RunApp,
        subcommands: {
          resume: { command: RunAppResume, subcommands: {} },
        },
      },
    },
  },
  version: { command: Version, subcommands: {} },
}
