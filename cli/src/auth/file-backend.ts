import type { TokenStore } from './store.js'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { DIR_PERM, FILE_PERM } from '../config/dir.js'

export const TOKENS_FILE_NAME = 'tokens.yml'

type AccountMap = Record<string, string>
type HostMap = Record<string, AccountMap>
type TokensFile = { hosts?: HostMap }

export class FileBackend implements TokenStore {
  private readonly dir: string
  private readonly path: string

  constructor(dir: string) {
    this.dir = dir
    this.path = join(dir, TOKENS_FILE_NAME)
  }

  async put(host: string, accountId: string, token: string): Promise<void> {
    const file = await this.read()
    const hosts = file.hosts ?? {}
    const accounts = hosts[host] ?? {}
    accounts[accountId] = token
    hosts[host] = accounts
    await this.write({ hosts })
  }

  async get(host: string, accountId: string): Promise<string | undefined> {
    const file = await this.read()
    return file.hosts?.[host]?.[accountId]
  }

  async delete(host: string, accountId: string): Promise<void> {
    const file = await this.read()
    const accounts = file.hosts?.[host]
    if (accounts === undefined || !(accountId in accounts))
      return
    delete accounts[accountId]
    if (Object.keys(accounts).length === 0 && file.hosts !== undefined)
      delete file.hosts[host]
    await this.write(file)
  }

  async list(host: string): Promise<readonly string[]> {
    const file = await this.read()
    const accounts = file.hosts?.[host]
    return accounts === undefined ? [] : Object.keys(accounts)
  }

  private async read(): Promise<TokensFile> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        return {}
      throw err
    }
    let parsed: unknown
    try {
      parsed = yaml.load(raw)
    }
    catch {
      return {}
    }
    if (parsed === null || typeof parsed !== 'object')
      return {}
    return parsed as TokensFile
  }

  private async write(file: TokensFile): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: DIR_PERM })
    const body = yaml.dump(file, { lineWidth: -1, noRefs: true })
    const tmp = `${this.path}.tmp.${process.pid}.${Date.now()}`
    try {
      await writeFile(tmp, body, { mode: FILE_PERM })
      await rename(tmp, this.path)
    }
    catch (err) {
      try {
        await unlink(tmp)
      }
      catch { /* tmp may not exist */ }
      throw err
    }
    try {
      const info = await stat(this.path)
      if ((info.mode & 0o777) !== FILE_PERM) {
        const { chmod } = await import('node:fs/promises')
        await chmod(this.path, FILE_PERM)
      }
    }
    catch { /* best-effort permission tighten */ }
  }
}
