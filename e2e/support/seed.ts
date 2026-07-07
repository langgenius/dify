import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { e2eDir } from '../scripts/common'

export type SeedStatus = 'blocked' | 'created' | 'skipped' | 'updated' | 'verified'

export type SeedResource = {
  id?: string
  kind: string
  name: string
}

export type SeedResult = {
  reason?: string
  resource?: SeedResource
  status: SeedStatus
  title: string
}

export type SeedContext = {
  dryRun: boolean
  resources: Map<string, SeedResource>
}

export type SeedTask = {
  id: string
  run: (context: SeedContext) => Promise<SeedResult>
  title: string
}

const reportDir = path.join(e2eDir, 'seed-report')

export const created = (title: string, resource?: SeedResource): SeedResult => ({
  resource,
  status: 'created',
  title,
})

export const updated = (title: string, resource?: SeedResource): SeedResult => ({
  resource,
  status: 'updated',
  title,
})

export const verified = (title: string, resource?: SeedResource): SeedResult => ({
  resource,
  status: 'verified',
  title,
})

export const skipped = (title: string, reason: string): SeedResult => ({
  reason,
  status: 'skipped',
  title,
})

export const blocked = (title: string, reason: string): SeedResult => ({
  reason,
  status: 'blocked',
  title,
})

export async function runSeedTasks(tasks: SeedTask[], context: SeedContext) {
  const results: SeedResult[] = []

  for (const task of tasks) {
    const result = await task.run(context)
    results.push(result)
    if (result.resource)
      context.resources.set(task.id, result.resource)

    const suffix = result.reason ? `: ${result.reason}` : ''
    console.warn(`[seed] ${result.status.padEnd(8)} ${result.title}${suffix}`)
  }

  return results
}

export async function writeSeedReport(pack: string, results: SeedResult[]) {
  await mkdir(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, `${pack}.json`)
  await writeFile(
    reportPath,
    `${JSON.stringify({
      generated_at: new Date().toISOString(),
      pack,
      results,
    }, null, 2)}\n`,
    'utf8',
  )

  return reportPath
}
