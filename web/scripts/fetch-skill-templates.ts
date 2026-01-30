import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_URL = 'https://github.com/anthropics/skills.git'
const __dirname = dirname(fileURLToPath(import.meta.url))
const CLONE_DIR = join(process.env.TMPDIR || '/tmp', 'anthropic-skills')
const OUTPUT_DIR = join(
  __dirname,
  '../app/components/workflow/skill/start-tab/templates',
)
const SKILLS_OUTPUT_DIR = join(OUTPUT_DIR, 'skills')

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.py',
  '.sh',
  '.txt',
  '.xml',
  '.json',
  '.html',
  '.js',
  '.css',
  '.ts',
  '.tsx',
  '.jsx',
  '.yaml',
  '.yml',
  '.toml',
  '.cfg',
  '.ini',
  '.conf',
  '.env',
  '.gitignore',
  '.editorconfig',
  '.prettierrc',
  '.eslintrc',
  '.svg',
  '.csv',
  '.tsv',
  '.log',
  '.rst',
  '.tex',
  '.r',
  '.rb',
  '.lua',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.bat',
  '.cmd',
  '.ps1',
  '.zsh',
  '.bash',
  '.fish',
])

const SKIP_FILES = new Set(['LICENSE.txt'])

const UI_CONFIG: Record<string, { displayName: string, icon: string, tags: string[] }> = {
  'pdf': { displayName: 'PDF', icon: '📄', tags: ['Document', 'Productivity'] },
  'docx': { displayName: 'DOCX', icon: '📝', tags: ['Document', 'Productivity'] },
  'pptx': { displayName: 'PPTX', icon: '📊', tags: ['Document', 'Productivity'] },
  'xlsx': { displayName: 'XLSX', icon: '📈', tags: ['Document', 'Productivity'] },
  'frontend-design': { displayName: 'Frontend Design', icon: '🎨', tags: ['Development', 'Design'] },
  'canvas-design': { displayName: 'Canvas Design', icon: '🖼️', tags: ['Design', 'Creative'] },
  'algorithmic-art': { displayName: 'Algorithmic Art', icon: '✨', tags: ['Creative', 'Development'] },
  'mcp-builder': { displayName: 'MCP Builder', icon: '🔌', tags: ['Development'] },
  'web-artifacts-builder': { displayName: 'Web Artifacts Builder', icon: '🌐', tags: ['Development', 'Design'] },
  'doc-coauthoring': { displayName: 'Doc Co-authoring', icon: '📋', tags: ['Productivity'] },
  'skill-creator': { displayName: 'Skill Creator', icon: '🛠️', tags: ['Development'] },
  'webapp-testing': { displayName: 'Webapp Testing', icon: '🧪', tags: ['Development'] },
  'slack-gif-creator': { displayName: 'Slack GIF Creator', icon: '🎬', tags: ['Creative', 'Productivity'] },
  'theme-factory': { displayName: 'Theme Factory', icon: '🎭', tags: ['Design'] },
  'brand-guidelines': { displayName: 'Brand Guidelines', icon: '🏷️', tags: ['Design', 'Productivity'] },
  'internal-comms': { displayName: 'Internal Comms', icon: '💬', tags: ['Productivity'] },
}

type FileEntry = {
  name: string
  node_type: 'file'
  content: string
  encoding?: 'base64'
}

type FolderEntry = {
  name: string
  node_type: 'folder'
  children: TreeEntry[]
}

type TreeEntry = FileEntry | FolderEntry

type SkillMeta = {
  id: string
  name: string
  description: string
  fileCount: number
}

function isTextFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext))
    return true
  if (ext === '')
    return true
  return false
}

function countFiles(entries: TreeEntry[]): number {
  let count = 0
  for (const entry of entries) {
    if (entry.node_type === 'file')
      count++
    else
      count += countFiles(entry.children)
  }
  return count
}

function readDirectoryTree(dirPath: string): TreeEntry[] {
  const entries: TreeEntry[] = []
  const items = readdirSync(dirPath).sort()

  for (const item of items) {
    if (SKIP_FILES.has(item))
      continue

    const fullPath = join(dirPath, item)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      entries.push({
        name: item,
        node_type: 'folder',
        children: readDirectoryTree(fullPath),
      })
    }
    else if (stat.isFile()) {
      if (isTextFile(fullPath)) {
        entries.push({
          name: item,
          node_type: 'file',
          content: readFileSync(fullPath, 'utf-8'),
        })
      }
      else {
        entries.push({
          name: item,
          node_type: 'file',
          content: readFileSync(fullPath).toString('base64'),
          encoding: 'base64',
        })
      }
    }
  }

  return entries
}

function parseFrontmatter(content: string): { name: string, description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match)
    return { name: '', description: '' }

  const yaml = match[1]
  let name = ''
  let description = ''

  for (const line of yaml.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)/)
    if (nameMatch)
      name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
    const descMatch = line.match(/^description:\s*(.+)/)
    if (descMatch)
      description = descMatch[1].trim().replace(/^["']|["']$/g, '')
  }

  return { name, description }
}

function generateSkillFile(id: string, children: TreeEntry[]): string {
  const lines: string[] = []
  lines.push('// AUTO-GENERATED — DO NOT EDIT')
  lines.push('// Source: https://github.com/anthropics/skills')
  lines.push('import type { SkillTemplateNode } from \'../types\'')
  lines.push('')
  lines.push(`const children: SkillTemplateNode[] = ${JSON.stringify(children, null, 2)}`)
  lines.push('')
  lines.push('export default children')
  lines.push('')
  return lines.join('\n')
}

function sq(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}

function generateRegistryFile(metas: SkillMeta[]): string {
  const lines: string[] = []
  lines.push('// AUTO-GENERATED — DO NOT EDIT')
  lines.push('// Source: https://github.com/anthropics/skills')
  lines.push('import type { SkillTemplateEntry } from \'./types\'')
  lines.push('')
  lines.push('export const SKILL_TEMPLATES: SkillTemplateEntry[] = [')

  for (const meta of metas) {
    const config = UI_CONFIG[meta.id] || { displayName: '', icon: '📁', tags: [] }
    const displayName = config.displayName || meta.name
    const tagsStr = `[${config.tags.map(t => sq(t)).join(', ')}]`
    lines.push('  {')
    lines.push(`    id: ${sq(meta.id)},`)
    lines.push(`    name: ${sq(displayName)},`)
    lines.push(`    description: ${sq(meta.description)},`)
    lines.push(`    fileCount: ${meta.fileCount},`)
    lines.push(`    icon: ${sq(config.icon)},`)
    lines.push(`    tags: ${tagsStr},`)
    lines.push(`    loadContent: () => import(${sq(`./skills/${meta.id}`)}).then(m => m.default),`)
    lines.push('  },')
  }

  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

function main() {
  console.log('Cloning anthropics/skills...')
  if (existsSync(CLONE_DIR))
    rmSync(CLONE_DIR, { recursive: true })
  execSync(`git clone --depth 1 ${REPO_URL} ${CLONE_DIR}`, { stdio: 'inherit' })

  const skillsDir = join(CLONE_DIR, 'skills')
  if (!existsSync(skillsDir)) {
    console.error('Error: skills/ directory not found in cloned repo')
    process.exit(1)
  }

  const skillDirs = readdirSync(skillsDir)
    .filter(name => statSync(join(skillsDir, name)).isDirectory())
    .sort()

  console.log(`Found ${skillDirs.length} skills: ${skillDirs.join(', ')}`)

  if (!existsSync(SKILLS_OUTPUT_DIR))
    mkdirSync(SKILLS_OUTPUT_DIR, { recursive: true })

  const metas: SkillMeta[] = []

  for (const skillId of skillDirs) {
    const skillPath = join(skillsDir, skillId)
    const children = readDirectoryTree(skillPath)
    const fileCount = countFiles(children)

    const skillMdPath = join(skillPath, 'SKILL.md')
    let meta: { name: string, description: string } = { name: skillId, description: '' }
    if (existsSync(skillMdPath))
      meta = parseFrontmatter(readFileSync(skillMdPath, 'utf-8'))

    if (!meta.name)
      meta.name = skillId

    metas.push({
      id: skillId,
      name: meta.name,
      description: meta.description,
      fileCount,
    })

    const outputPath = join(SKILLS_OUTPUT_DIR, `${skillId}.ts`)
    writeFileSync(outputPath, generateSkillFile(skillId, children))
    console.log(`  Generated ${relative(OUTPUT_DIR, outputPath)} (${fileCount} files)`)
  }

  const registryPath = join(OUTPUT_DIR, 'registry.ts')
  writeFileSync(registryPath, generateRegistryFile(metas))
  console.log(`Generated registry.ts with ${metas.length} entries`)

  console.log('Cleaning up...')
  rmSync(CLONE_DIR, { recursive: true })
  console.log('Done!')
}

main()
