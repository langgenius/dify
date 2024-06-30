const translation = {
  title: 'Knowledge settings',
  desc: 'Here you can modify the properties and working methods of the Knowledge.',
  form: {
    name: 'Knowledge Name',
    namePlaceholder: 'Please enter the Knowledge name',
    nameError: 'Name cannot be empty',
    desc: 'Knowledge description',
    descInfo: 'Please write a clear textual description to outline the content of the Knowledge. This description will be used as a basis for matching when selecting from multiple Knowledge for inference.',
    descPlaceholder: 'Describe what is in this Knowledge. A detailed description allows AI to access the content of the Knowledge in a timely manner. If empty, Dify will use the default hit strategy.',
    descWrite: 'Learn how to write a good Knowledge description.',
    permissions: 'Permissions',
    permissionsOnlyMe: 'Only me',
    permissionsAllMember: 'All team members',
    indexMethod: 'Index Method',
    indexMethodHighQuality: 'High Quality',
    indexMethodHighQualityTip: 'Call Embedding model for processing to provide higher accuracy when users query.',
    indexMethodEconomy: 'Economical',
    indexMethodEconomyTip: 'Use offline vector engines, keyword indexes, etc. to reduce accuracy without spending tokens',
    embeddingModel: 'Embedding Model',
    embeddingModelTip: 'Change the embedded model, please go to ',
    embeddingModelTipLink: 'Settings',
    retrievalSetting: {
      title: 'Retrieval setting',
      learnMore: 'Learn more',
      description: ' about retrieval method.',
      longDescription: ' about retrieval method, you can change this at any time in the Knowledge settings.',
    },
    save: 'Save',
  },
}

export default translation
