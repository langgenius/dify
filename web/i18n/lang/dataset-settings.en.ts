const translation = {
  title: 'Knowledge base settings',
  desc: 'Here you can modify the properties and working methods of the knowledge base.',
  form: {
    name: 'Knowledge base Name',
    namePlaceholder: 'Please enter the knowledge base name',
    nameError: 'Name cannot be empty',
    desc: 'Knowledge base description',
    descInfo: 'Please write a clear textual description to outline the content of the knowledge base. This description will be used as a basis for matching when selecting from multiple Knowledge base for inference.',
    descPlaceholder: 'Describe what is in this data set. A detailed description allows AI to access the content of the data set in a timely manner. If empty, Dify will use the default hit strategy.',
    descWrite: 'Learn how to write a good knowledge base description.',
    permissions: 'Permissions',
    permissionsOnlyMe: 'Only me',
    permissionsAllMember: 'All team members',
    indexMethod: 'Index Method',
    indexMethodHighQuality: 'High Quality',
    indexMethodHighQualityTip: 'Call OpenAI\'s embedding interface for processing to provide higher accuracy when users query.',
    indexMethodEconomy: 'Economical',
    indexMethodEconomyTip: 'Use offline vector engines, keyword indexes, etc. to reduce accuracy without spending tokens',
    embeddingModel: 'Embedding Model',
    embeddingModelTip: 'Change the embedded model, please go to ',
    embeddingModelTipLink: 'Settings',
    retrievalSetting: {
      title: 'Retrieval setting',
      learnMore: 'Learn more',
      description: ' about retrieval method.',
      longDescription: ' about retrieval method, you can change this at any time in the knowledge base settings.',
    },
    save: 'Save',
  },
}

export default translation
