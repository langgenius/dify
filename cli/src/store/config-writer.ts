import type { ConfigFile } from '../config/schema'
import type { YamlStore } from './store'
import { CURRENT_SCHEMA_VERSION } from '../config/schema'

export function saveConfig(store: YamlStore, config: ConfigFile): void {
  const stamped: ConfigFile = { ...config, schema_version: CURRENT_SCHEMA_VERSION }
  store.setTyped(stamped)
}
