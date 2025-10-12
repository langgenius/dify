import type { Memory as MemoryItem } from '@/app/components/base/chat/types'

export const mockMemoryList: MemoryItem[] = [
  {
    tenant_id: 'user-tenant-id',
    value: `Learning Goal: [What you\'re studying]
    Current Level: [Beginner/Intermediate/Advanced]
    Learning Style: [Visual, hands-on, theoretical, etc.]
    Progress: [Topics mastered, current focus]
    Preferred Pace: [Fast/moderate/slow explanations]
    Background: [Relevant experience or education]
    Time Constraints: [Available study time]`,
    app_id: 'user-app-id',
    conversation_id: '',
    version: 1,
    edited_by_user: false,
    conversation_metadata: {
      type: 'mutable_visible_window',
      visible_count: 5,
    },
    spec: {
      id: 'learning_companion',
      name: 'Learning Companion',
      description: 'A companion to help with learning goals',
      template: 'no zuo no die why you try', // default value
      instruction: 'enjoy yourself',
      scope: 'app', // app or node
      term: 'session', // session or persistent
      strategy: 'on_turns',
      update_turns: 3,
      preserved_turns: 5,
      schedule_mode: 'sync', // sync or async
      end_user_visible: true,
      end_user_editable: true,
    },
  },
  {
    tenant_id: 'user-tenant-id',
    value: `Research Topic: [Your research topic]
    Current Progress: [Literature review, experiments, etc.]
    Challenges: [What you\'re struggling with]
    Goals: [Short-term and long-term research goals]`,
    app_id: 'user-app-id',
    conversation_id: '',
    version: 1,
    edited_by_user: false,
    conversation_metadata: {
      type: 'mutable_visible_window',
      visible_count: 5,
    },
    spec: {
      id: 'research_partner',
      name: 'research_partner',
      description: 'A companion to help with research goals',
      template: 'no zuo no die why you try', // default value
      instruction: 'enjoy yourself',
      scope: 'app', // app or node
      term: 'session', // session or persistent
      strategy: 'on_turns',
      update_turns: 3,
      preserved_turns: 3,
      schedule_mode: 'sync', // sync or async
      end_user_visible: true,
      end_user_editable: false,
    },
  },
  {
    tenant_id: 'user-tenant-id',
    value: `Code Context: [Brief description of the codebase]
    Current Issues: [Bugs, technical debt, etc.]
    Goals: [Features to implement, improvements to make]`,
    app_id: 'user-app-id',
    conversation_id: '',
    version: 3,
    edited_by_user: true,
    conversation_metadata: {
      type: 'mutable_visible_window',
      visible_count: 5,
    },
    spec: {
      id: 'code_partner',
      name: 'code_partner',
      description: 'A companion to help with code-related tasks',
      template: 'no zuo no die why you try', // default value
      instruction: 'enjoy yourself',
      scope: 'app', // app or node
      term: 'session', // session or persistent
      strategy: 'on_turns',
      update_turns: 3,
      preserved_turns: 5,
      schedule_mode: 'sync', // sync or async
      end_user_visible: true,
      end_user_editable: true,
    },
  },
]
