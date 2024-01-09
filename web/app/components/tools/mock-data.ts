export const collectionList = [
  {
    author: 'Dify',
    name: 'google',
    description: {
      zh_Hans: 'GoogleSearch',
      en_US: 'Google',
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
    is_team_authorization: true,
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
