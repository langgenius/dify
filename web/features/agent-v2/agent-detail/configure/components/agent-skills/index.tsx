'use client'

import type { AgentSkill } from './agent-skill-item'
import { useTranslation } from 'react-i18next'
import { ConfigureSection } from '../configure-section'
import { AgentSkillItem } from './agent-skill-item'

const createSkillDetail = (skillName: string) => ({
  description: 'Dify brand executor rules, voice, typography, layout patterns, and visual design system. Use when generating any Dify brand material including web pages, social graphics, presentations, one-pagers, and pitch decks.',
  fileCount: 12,
  files: [
    {
      id: `${skillName}-skill-md`,
      name: 'SKILL.md',
      icon: 'markdown' as const,
    },
    {
      id: `${skillName}-output-schema`,
      name: 'output_schema.json',
      icon: 'json' as const,
    },
    {
      id: `${skillName}-toolmap`,
      name: 'toolmap.yaml',
      icon: 'file' as const,
    },
    {
      id: `${skillName}-examples`,
      name: 'examples.json',
      icon: 'json' as const,
    },
    {
      id: `${skillName}-readme`,
      name: 'README.md',
      icon: 'markdown' as const,
    },
    {
      id: `${skillName}-src`,
      name: 'scripts',
      icon: 'folder' as const,
      children: [
        {
          id: `${skillName}-calculate-discount`,
          name: 'calculate_discount.py',
          icon: 'code' as const,
        },
        {
          id: `${skillName}-references`,
          name: 'references',
          icon: 'folder' as const,
          children: [
            {
              id: `${skillName}-references-brand`,
              name: 'brand-guidelines',
              icon: 'folder' as const,
              children: [
                {
                  id: `${skillName}-references-brand-typography`,
                  name: 'typography-and-layout-rules-for-long-form-output.md',
                  icon: 'markdown' as const,
                },
                {
                  id: `${skillName}-references-brand-tone`,
                  name: 'voice-tone-and-product-narrative-reference.md',
                  icon: 'markdown' as const,
                },
              ],
            },
            {
              id: `${skillName}-references-implementation`,
              name: 'implementation-notes',
              icon: 'folder' as const,
              children: [
                {
                  id: `${skillName}-references-implementation-checklist`,
                  name: 'agent-runtime-validation-checklist.json',
                  icon: 'json' as const,
                },
              ],
            },
          ],
        },
        {
          id: `${skillName}-assets`,
          name: 'assets',
          icon: 'folder' as const,
          children: [
            {
              id: `${skillName}-assets-examples`,
              name: 'examples',
              icon: 'folder' as const,
              children: [
                {
                  id: `${skillName}-assets-examples-brief`,
                  name: 'sample-output-brief-with-extra-long-file-name-for-truncation.md',
                  icon: 'markdown' as const,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  sections: [
    {
      id: 'text-formatting',
      title: '2. Text Formatting',
      items: [
        'Bold is used for emphasis, e.g. Please double-check your username and password when logging in.',
        'Italics can be used for terminology, e.g. We use the React framework for front-end development.',
        'Strikethrough is used for outdated information, e.g. Old version requires manual environment setup.',
        'Code is used for inline code, e.g. Use npm install.',
        'Inline quotes indicate short verbatim phrasing.',
        'Headings should keep the same information hierarchy as the source material and avoid decorative title casing when the content is ordinary body copy.',
        'Use concise link text that describes the destination, and avoid bare URLs unless the URL itself is the thing a user needs to inspect.',
        'When translating technical material, keep command names, package names, environment variables, and file names in their original form.',
      ],
    },
    {
      id: 'paragraph',
      title: 'Paragraph',
      paragraphs: [
        'The capitalization in the phrase “An Open-Source LLM Apps Development Platform” seems mostly correct, but it depends on the specific context in which it is used. If this is a title or a heading, capitalization style may be appropriate. If it appears in body copy, use sentence case for better readability.',
        'For product surfaces, the skill should preserve the source intent while making the final copy easier to scan. Long paragraphs should be broken into compact blocks, but not so aggressively that the original reasoning is lost. Use plain language, keep examples close to the rules they illustrate, and avoid adding marketing claims that are not present in the source material.',
        'When the input mixes product guidance, implementation notes, and design-system constraints, prefer a structured explanation that separates rule, rationale, and example. This makes the output easier for downstream agents to reuse without guessing which parts are mandatory and which parts are contextual advice.',
      ],
    },
    {
      id: 'lists',
      title: '3. Lists',
      items: [
        'Unordered list for project to-do items.',
        'Ordered list for deployment steps.',
        'Keep list copy concise and scannable.',
        'Group related checklist items together so users can complete one workflow before moving to the next.',
        'Use numbered steps when order matters, especially for setup, migration, deployment, and verification procedures.',
        'Use unordered bullets for independent requirements, available options, design constraints, or evidence gathered during review.',
        'Avoid nested lists unless the hierarchy is essential. If a second level is needed, keep the child list short and directly tied to the parent item.',
        'For long operational guidance, end each section with an observable success condition so another agent can verify completion.',
      ],
    },
    {
      id: 'workflow',
      title: '4. Workflow Rules',
      paragraphs: [
        'Before using this skill, inspect the current workspace and identify whether the user is asking for implementation, review, transformation, or diagnosis. The same source files can require very different outputs depending on that workflow.',
        'Prefer existing project primitives and local conventions over introducing a new abstraction. If the target project already provides a dialog, scroll area, file tree, or typography token, compose those pieces directly and keep feature-specific styling at the call site.',
      ],
      items: [
        'Read the nearby owner component before changing behavior.',
        'Keep mock data at the call site until a real backend contract is ready.',
        'Use generated or project-owned contracts when API data becomes available.',
        'Run the narrowest meaningful verification first, then broaden only when the change touches shared behavior.',
      ],
    },
    {
      id: 'quality-bar',
      title: '5. Quality Bar',
      paragraphs: [
        'The skill output should be specific enough that a reviewer can reproduce the reasoning without reading hidden context. It should name the files, inputs, assumptions, and constraints that influenced the answer. When evidence is unavailable, state the gap directly instead of filling it with generic best practices.',
        'For UI output, keep the generated structure aligned with the design system. Do not replace a primitive with a generic div just to make a screenshot look similar. If a primitive cannot express the design, document the exact missing capability before adding feature-local styling.',
      ],
      items: [
        'No hardcoded user-facing copy outside the feature namespace.',
        'No manual overlay portal or z-index override when a design-system overlay exists.',
        'No unbounded content region that can push the dialog outside the viewport.',
        'No file names or labels that can resize the file list card when folders expand.',
      ],
    },
  ],
})

const defaultSkills: AgentSkill[] = [
  {
    id: 'tender-analyzer-1',
    name: 'tender-analyzer',
    detail: createSkillDetail('tender-analyzer'),
  },
  {
    id: 'playwright',
    name: 'Playwright',
    detail: createSkillDetail('Playwright'),
  },
  {
    id: 'figma-code-connect',
    name: 'Figma Code Connect',
    detail: createSkillDetail('Figma Code Connect'),
  },
  {
    id: 'tender-analyzer-2',
    name: 'tender-analyzer',
    detail: createSkillDetail('tender-analyzer'),
  },
]

export function AgentSkills({
  skills = defaultSkills,
}: {
  skills?: AgentSkill[]
}) {
  const { t } = useTranslation('agentV2')
  const skillsTip = t('agentDetail.configure.skills.tip')
  const skillsListId = 'agent-configure-skills-list'

  return (
    <ConfigureSection
      label={t('agentDetail.configure.skills.label')}
      labelId="agent-configure-skills-label"
      panelId={skillsListId}
      tip={skillsTip}
      tipAriaLabel={skillsTip}
      rootClassName="border-b border-divider-subtle pt-4"
      panelContentClassName="flex flex-col gap-1 pb-4"
      actions={(
        <button
          type="button"
          aria-label={t('agentDetail.configure.skills.add')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-add-line size-4" />
        </button>
      )}
    >
      {skills.map(skill => (
        <AgentSkillItem key={skill.id} skill={skill} />
      ))}
    </ConfigureSection>
  )
}
