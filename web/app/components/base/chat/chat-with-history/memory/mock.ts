import type { MemoryItem } from './type'
export const mockMemoryList: MemoryItem[] = [
  {
    name: 'learning_companion',
    content: 'Learning Goal: [What you\'re studying] \\n Current Level: [Beginner/Intermediate/Advanced] \\n Learning Style: [Visual, hands-on, theoretical, etc.] \\n Progress: [Topics mastered, current focus] \\n Preferred Pace: [Fast/moderate/slow explanations] \\n Background: [Relevant experience or education] \\n Time Constraints: [Available study time]',
  },
  {
    name: 'research_partner',
    content: 'Research Topic: [Your research topic] \\n Current Progress: [Literature review, experiments, etc.] \\n Challenges: [What you\'re struggling with] \\n Goals: [Short-term and long-term research goals]',
    status: 'latest',
  },
  {
    name: 'code_partner',
    content: 'Code Context: [Brief description of the codebase] \\n Current Issues: [Bugs, technical debt, etc.] \\n Goals: [Features to implement, improvements to make]',
    status: 'needUpdate',
    mergeCount: 5,
  },
]
