export const collectionList = [
  {
    author: 'Dify',
    name: 'google',
    description: {
      zh_Hans: 'Google Search',
      en_US: 'Google Search',
    },
    icon: 'https://placehold.co/100x100/EEE/31343C',
    label: {
      zh_Hans: 'Google',
      en_US: 'Google',
    },
    type: 'builtin',
    team_credentials: {
      serpapi_api_key: '763******40a',
    },
    is_team_authorization: false,
  },
  {
    author: 'Yeuoly Yeuoly Chou',
    name: 'self_apia',
    description: {
      zh_Hans: 'asd',
      en_US: 'asd',
    },
    icon: {
      background: '#252525',
      content: '\uD83D\uDE01',
    },
    label: {
      zh_Hans: 'self_apia',
      en_US: 'self_apia',
    },
    type: 'api',
    team_credentials: {
      auth_type: 'api******key',
    },
    is_team_authorization: true,
  },
] as any

export const selectedToolList = [
  {
    id: '1',
    name: 'Data Search',
    enabled: true,
  },
  {
    id: '2',
    name: 'File Reader',
    enabled: false,
  },
  {
    id: '3',
    name: 'Calendar',
    enabled: true,
  },
  {
    id: '4',
    name: 'Data Search',
    enabled: false,
  },
  // {
  //   id: '5',
  //   name: 'Calendar',
  //   enabled: true,
  // },
  // {
  //   id: '6',
  //   name: 'Data Search',
  //   enabled: false,
  // },
]

export const builtInTools = [
  {
    name: 'Fetch Google',
    label: {
      zh_Hans: 'Fetch Google',
      en_US: 'Fetch Google',
    },
    description: {
      zh_Hans: 'Des...',
      en_US: 'Des1...',
    },
  },
  {
    name: 'Fetch Google Event',
    label: {
      zh_Hans: 'Fetch Google',
      en_US: 'Fetch Google Event',
    },
    description: {
      zh_Hans: 'Des...',
      en_US: 'Des2...',
    },
  },
  {
    name: 'Fetch Google Calendar Event2',
    label: {
      zh_Hans: 'Fetch Google',
      en_US: 'Fetch Google Event2',
    },
    description: {
      zh_Hans: 'Des...',
      en_US: 'Des...',
    },
  },
  {
    name: 'Fetch Google3',
    label: {
      zh_Hans: 'Fetch Google',
      en_US: 'Fetch Google Event3',
    },
    description: {
      zh_Hans: 'Des...',
      en_US: 'Des...',
    },
  },
  {
    name: 'Fetch Google4',
    label: {
      zh_Hans: 'Fetch Google',
      en_US: 'Fetch Google Event4',
    },
    description: {
      zh_Hans: 'Des...',
      en_US: 'Des...',
    },
  },
]

export const CustomTools = [
  {
    name: 'Add Pet',
    label: {
      zh_Hans: 'Fetch Google',
      en_US: 'Add Pet',
    },
    description: {
      zh_Hans: 'Des...',
      en_US: 'Des...',
    },
  },
  {
    name: 'Update Pet',
    label: {
      zh_Hans: 'Fetch Google',
      en_US: 'Update Pet',
    },
    description: {
      zh_Hans: 'Des...',
      en_US: 'Des...',
    },
  },
  {
    name: 'Query Pet',
    label: {
      zh_Hans: 'Fetch Google',
      en_US: 'Query Pet',
    },
    description: {
      zh_Hans: 'Des...',
      en_US: 'Des...',
    },
  },
  {
    name: 'Delete Pet',
    label: {
      zh_Hans: 'Fetch Google',
      en_US: 'Delete Pet',
    },
    description: {
      zh_Hans: 'Des...',
      en_US: 'Des...',
    },
  },
]
