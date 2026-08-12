import type { CommandTree } from '@/framework/registry'
import { describe, expect, it } from 'vitest'
import { ExitCode } from '@/errors/codes'
import { run } from '@/framework/run'
import { renderSkill } from '@/help/skill'
import { versionInfo } from '@/version/info'
import SkillsInstall from './index'

const tree: CommandTree = {
  skills: { subcommands: { install: { command: SkillsInstall, subcommands: {} } } },
}

type Captured = { stdout: string; stderr: string; exit: number | undefined }

async function captureRun(argv: string[]): Promise<Captured> {
  const captured: Captured = { stdout: '', stderr: '', exit: undefined }
  const origStdout = process.stdout.write.bind(process.stdout)
  const origStderr = process.stderr.write.bind(process.stderr)
  const origExit = process.exit.bind(process)

  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured.stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured.stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    return true
  }) as typeof process.stderr.write
  process.exit = ((code?: number) => {
    captured.exit = code
  }) as typeof process.exit

  try {
    await run(tree, argv)
  } finally {
    process.stdout.write = origStdout
    process.stderr.write = origStderr
    process.exit = origExit
  }
  return captured
}

describe('skills install command', () => {
  it('prints the skill verbatim under --stdout and exits 0', async () => {
    const result = await captureRun(['skills', 'install', '--stdout'])
    expect(result.stdout).toBe(renderSkill({ version: versionInfo.version }))
    expect(result.exit).toBeUndefined()
  })

  it('rejects --stdout combined with --yes (exit 2, no output)', async () => {
    const result = await captureRun(['skills', 'install', '--stdout', '--yes'])
    expect(result.exit).toBe(ExitCode.Usage)
    expect(result.stdout).toBe('')
  })

  it('rejects --stdout combined with a directory (exit 2)', async () => {
    const result = await captureRun(['skills', 'install', './out', '--stdout'])
    expect(result.exit).toBe(ExitCode.Usage)
  })

  it('rejects a directory combined with --agent (exit 2)', async () => {
    const result = await captureRun(['skills', 'install', './out', '--agent', 'claude-code'])
    expect(result.exit).toBe(ExitCode.Usage)
  })
})
