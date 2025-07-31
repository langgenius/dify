import type { MemoryItem } from './type'
export const mockMemoryList: MemoryItem[] = [
  {
    name: 'learning_companion',
    content: `Learning Goal: [What you\'re studying]
    Current Level: [Beginner/Intermediate/Advanced]
    Learning Style: [Visual, hands-on, theoretical, etc.]
    Progress: [Topics mastered, current focus]
    Preferred Pace: [Fast/moderate/slow explanations]
    Background: [Relevant experience or education]
    Time Constraints: [Available study time]`,
  },
  {
    name: 'research_partner',
    content: `Research Topic: [Your research topic]
    Current Progress: [Literature review, experiments, etc.]
    Challenges: [What you\'re struggling with]
    Goals: [Short-term and long-term research goals]`,
    status: 'latest',
  },
  {
    name: 'code_partner',
    content: `Code Context: [Brief description of the codebase]
    Current Issues: [Bugs, technical debt, etc.]
    Goals: [Features to implement, improvements to make]`,
    status: 'needUpdate',
    mergeCount: 5,
  },
]
