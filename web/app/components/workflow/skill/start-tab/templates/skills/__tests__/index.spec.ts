import algorithmicArt from '../algorithmic-art'
import brandGuidelines from '../brand-guidelines'
import canvasDesign from '../canvas-design'
import claudeApi from '../claude-api'
import docCoauthoring from '../doc-coauthoring'
import docx from '../docx'
import frontendDesign from '../frontend-design'
import internalComms from '../internal-comms'
import mcpBuilder from '../mcp-builder'
import pdf from '../pdf'
import pptx from '../pptx'
import skillCreator from '../skill-creator'
import slackGifCreator from '../slack-gif-creator'
import themeFactory from '../theme-factory'
import webArtifactsBuilder from '../web-artifacts-builder'
import webappTesting from '../webapp-testing'
import xlsx from '../xlsx'
import { SKILL_TEMPLATES } from '../../registry'
import type { SkillTemplateNode } from '../../types'

const countFiles = (nodes: SkillTemplateNode[]): number => {
  return nodes.reduce((count, node) => {
    if (node.node_type === 'file')
      return count + 1
    return count + countFiles(node.children)
  }, 0)
}

const templates = [
  { id: 'algorithmic-art', nodes: algorithmicArt },
  { id: 'brand-guidelines', nodes: brandGuidelines },
  { id: 'canvas-design', nodes: canvasDesign },
  { id: 'claude-api', nodes: claudeApi },
  { id: 'doc-coauthoring', nodes: docCoauthoring },
  { id: 'docx', nodes: docx },
  { id: 'frontend-design', nodes: frontendDesign },
  { id: 'internal-comms', nodes: internalComms },
  { id: 'mcp-builder', nodes: mcpBuilder },
  { id: 'pdf', nodes: pdf },
  { id: 'pptx', nodes: pptx },
  { id: 'skill-creator', nodes: skillCreator },
  { id: 'slack-gif-creator', nodes: slackGifCreator },
  { id: 'theme-factory', nodes: themeFactory },
  { id: 'web-artifacts-builder', nodes: webArtifactsBuilder },
  { id: 'webapp-testing', nodes: webappTesting },
  { id: 'xlsx', nodes: xlsx },
]

describe('skill template files', () => {
  it.each(templates)('should export a non-empty tree for %s', ({ id, nodes }) => {
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.every(node => Boolean(node.name))).toBe(true)

    const template = SKILL_TEMPLATES.find(item => item.id === id)

    expect(template).toBeDefined()
    expect(countFiles(nodes)).toBe(template?.fileCount)
  })
})
