import type { FileReader } from './request'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

export const readLocalFile: FileReader = async (path) => ({
  bytes: await readFile(path),
  name: basename(path),
})
