const translation = {
  title: 'Dataset settings',
  desc: 'Here you can modify the properties and working methods of the dataset.',
  form: {
    name: 'Dataset Name',
    nameError: 'Name cannot be empty',
    desc: 'Dataset description',
    descPlaceholder: 'Describe what is in this data set. A detailed description allows AI to access the content of the data set in a timely manner. If empty, Dify will use the default hit strategy.',
    descWrite: 'Learn how to write a good dataset description.',
    permissions: 'Permissions',
    permissionsOnlyMe: 'Only me',
    permissionsAllMember: 'All team members',
    indexMethod: 'Index Method',
    indexMethodHighQuality: 'High Quality',
    indexMethodHighQualityTip: 'Call OpenAI\'s embedding interface for processing to provide higher accuracy when users query.',
    indexMethodEconomy: 'Economical',
    indexMethodEconomyTip: 'Use offline vector engines, keyword indexes, etc. to reduce accuracy without spending tokens',
    save: 'Save',
  },
}

export default translation
