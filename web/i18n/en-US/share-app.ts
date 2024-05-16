const translation = {
  common: {
    welcome: 'Welcome to use',
    appUnavailable: 'App is unavailable',
    appUnkonwError: 'App is unavailable',
  },
  chat: {
    newChat: 'New chat',
    pinnedTitle: 'Pinned',
    unpinnedTitle: 'Chats',
    newChatDefaultName: 'New conversation',
    resetChat: 'Reset conversation',
    powerBy: 'Powered by',
    prompt: 'Prompt',
    privatePromptConfigTitle: 'Conversation settings',
    publicPromptConfigTitle: 'Initial Prompt',
    configStatusDes: 'Before start, you can modify conversation settings',
    configDisabled:
      'Previous session settings have been used for this session.',
    startChat: 'Start Chat',
    privacyPolicyLeft:
      'Please read the ',
    privacyPolicyMiddle:
      'privacy policy',
    privacyPolicyRight:
      ' provided by the app developer.',
    deleteConversation: {
      title: 'Delete conversation',
      content: 'Are you sure you want to delete this conversation?',
    },
    tryToSolve: 'Try to solve',
    temporarySystemIssue: 'Sorry, temporary system issue.',
  },
  generation: {
    tabs: {
      create: 'Run Once',
      batch: 'Run Batch',
      saved: 'Saved',
    },
    savedNoData: {
      title: 'You haven\'t saved a result yet!',
      description: 'Start generating content, and find your saved results here.',
      startCreateContent: 'Start create content',
    },
    title: 'AI Completion',
    queryTitle: 'Query content',
    completionResult: 'Completion result',
    queryPlaceholder: 'Write your query content...',
    run: 'Execute',
    copy: 'Copy',
    resultTitle: 'AI Completion',
    noData: 'AI will give you what you want here.',
    csvUploadTitle: 'Drag and drop your CSV file here, or ',
    browse: 'browse',
    csvStructureTitle: 'The CSV file must conform to the following structure:',
    downloadTemplate: 'Download the template here',
    field: 'Field',
    batchFailed: {
      info: '{{num}} failed executions',
      retry: 'Retry',
      outputPlaceholder: 'No output content',
    },
    errorMsg: {
      empty: 'Please input content in the uploaded file.',
      fileStructNotMatch: 'The uploaded CSV file not match the struct.',
      emptyLine: 'Row {{rowIndex}} is empty',
      invalidLine: 'Row {{rowIndex}}: {{varName}} value can not be empty',
      moreThanMaxLengthLine: 'Row {{rowIndex}}: {{varName}} value can not be more than {{maxLength}} characters',
      atLeastOne: 'Please input at least one row in the uploaded file.',
    },
  },
}

export default translation
