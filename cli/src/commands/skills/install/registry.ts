import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// The agents difyctl knows how to install its skill into: how to tell each one
// is in use on this machine, and where it reads user-level skills.
//
// Detection is config-DIRECTORY existence only — no PATH probe, no subprocess.
// difyctl spawns nothing at runtime, and a tool's config dir (`~/.claude`,
// `~/.codex`, `~/.config/opencode`, `~/.cursor`, `~/.pi`) is the reliable "this
// agent is set up here" signal; agents themselves discover each other's skills
// by reading these dirs, not by locating executables. The narrow "installed but
// never launched, so no config dir yet" case is served by `skills install <dir>`.
//
// `probeDir` (the detection signal) and `skillDir` (the install target) are kept
// separate because they diverge for some agents: Codex is configured under
// `~/.codex` but reads user skills from `~/.agents/skills`, and pi is configured
// under `~/.pi` but reads them from `~/.pi/agent/skills` (each tool's documented
// location). Adding an agent is one entry; paths are verified against its docs.
export type AgentEntry = {
  readonly name: string
  readonly probeDir: (home: string) => string
  readonly skillDir: (home: string) => string
}

export const AGENTS: readonly AgentEntry[] = [
  {
    name: 'claude-code',
    probeDir: home => join(home, '.claude'),
    skillDir: home => join(home, '.claude', 'skills', 'difyctl'),
  },
  {
    name: 'codex',
    probeDir: home => join(home, '.codex'),
    skillDir: home => join(home, '.agents', 'skills', 'difyctl'),
  },
  {
    name: 'opencode',
    probeDir: home => join(home, '.config', 'opencode'),
    skillDir: home => join(home, '.config', 'opencode', 'skills', 'difyctl'),
  },
  {
    name: 'cursor',
    probeDir: home => join(home, '.cursor'),
    skillDir: home => join(home, '.cursor', 'skills', 'difyctl'),
  },
  {
    name: 'pi',
    probeDir: home => join(home, '.pi'),
    skillDir: home => join(home, '.pi', 'agent', 'skills', 'difyctl'),
  },
]

// Agents whose config dir exists under `home`. `home` is injectable so tests can
// point at a temp dir instead of the real home.
export function detectAgents(home: string = homedir()): readonly AgentEntry[] {
  return AGENTS.filter(agent => existsSync(agent.probeDir(home)))
}
