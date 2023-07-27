const translation = {
  title: 'My Apps',
  sidebar: {
    discovery: 'Discovery',
    chat: 'Chat',
    workspace: 'Workspace',
    action: {
      pin: 'Pin',
      unpin: 'Unpin',
      delete: 'Delete',
    },
    delete: {
      title: 'Delete app',
      content: 'Are you sure you want to delete this app?',
    },
  },
  apps: {
    title: 'Explore Apps by Dify',
    description: 'Use these template apps instantly or customize your own apps based on the templates.',
    allCategories: 'All Categories',
  },
  appCard: {
    addToWorkspace: 'Add to Workspace',
    customize: 'Customize',
  },
  appCustomize: {
    title: 'Create app from {{name}}',
    subTitle: 'App icon & name',
    nameRequired: 'App name is required',
  },
  category: {
    Assistant: 'Assistant',
    Writing: 'Writing',
    Translate: 'Translate',
    Programming: 'Programming',
    HR: 'HR',
  },
  universalChat: {
    welcome: 'Start chat with Dify',
    welcomeDescribe: 'Your AI conversation companion for personalized assistance',
    model: 'Model',
    plugins: {
      name: 'Plugins',
      google_search: {
        name: 'Google Search',
        more: {
          left: 'Enable the plugin, ',
          link: 'set up your SerpAPI key',
          right: ' first.',
        },
      },
      web_reader: {
        name: 'Web Reader',
        description: 'Get needed information from any web link',
      },
      wikipedia: {
        name: 'Wikipedia',
      },
    },
    thought: {
      show: 'Show',
      hide: 'Hide',
      processOfThought: ' the process of thinking',
      res: {
        webReader: {
          normal: 'Reading {url}',
          hasPageInfo: 'Reading next page of {url}',
        },
        google: 'Searching Google {{query}}',
        wikipedia: 'Searching Wikipedia {{query}}',
        dataset: 'Retrieving dataset {datasetName}',
        date: 'Searching date',
      },
    },
    viewConfigDetailTip: 'In conversation, cannot change above settings',
  },
}

export default translation
