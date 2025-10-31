const translation = {
  common: {
    goToAddDocuments: 'Go to add documents',
    publishAs: 'Publish as a Customized Pipeline Template',
    confirmPublish: 'Confirm Publish',
    confirmPublishContent: 'After successfully publishing the knowledge pipeline, the chunk structure of this knowledge base cannot be modified. Are you sure you want to publish it?',
    publishAsPipeline: {
      name: 'Pipeline name & icon',
      namePlaceholder: 'Please enter the name of this Knowledge Pipeline. (Required) ',
      description: 'Knowledge description',
      descriptionPlaceholder: 'Please enter the description of this Knowledge Pipeline. (Optional) ',
    },
    testRun: 'Test Run',
    preparingDataSource: 'Preparing Data Source',
    reRun: 'Re-run',
    processing: 'Processing',
  },
  inputField: {
    create: 'Create user input field',
    manage: 'Manage',
  },
  publishToast: {
    title: 'This pipeline has not yet been published',
    desc: 'When the pipeline is not published, you can modify the chunk structure in the knowledge base node, and the pipeline orchestration and changes will be automatically saved as a draft.',
  },
  result: {
    resultPreview: {
      loading: 'Processing...Please wait',
      error: 'Error occurred during execution',
      viewDetails: 'View details',
      footerTip: 'In test run mode, preview up to {{count}} chunks',
    },
  },
  ragToolSuggestions: {
    title: 'Suggestions for RAG',
    noRecommendationPlugins: 'No recommended plugins, find more in <CustomLink>Marketplace</CustomLink>',
  },
}

export default translation
