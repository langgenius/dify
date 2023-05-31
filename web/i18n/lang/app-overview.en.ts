const translation = {
  welcome: {
    firstStepTip: 'To get started,',
    enterKeyTip: 'enter your OpenAI API Key below',
    getKeyTip: 'Get your API Key from OpenAI dashboard',
    placeholder: 'Your OpenAI API Key(eg.sk-xxxx)',
  },
  overview: {
    title: 'Overview',
    appInfo: {
      explanation: 'Ready-to-use AI WebApp',
      accessibleAddress: 'Public URL',
      preview: 'Preview',
      share: {
        entry: 'Share',
        explanation: 'Share the following URL to invite more people to access the application.',
        shareUrl: 'Share URL',
        copyLink: 'Copy Link',
        regenerate: 'Regenerate',
      },
      preUseReminder: 'Please enable WebApp before continuing.',
      settings: {
        entry: 'Settings',
        title: 'WebApp Settings',
        webName: 'WebApp Name',
        webDesc: 'WebApp Description',
        webDescTip: 'This text will be displayed on the client side, providing basic guidance on how to use the application',
        webDescPlaceholder: 'Enter the description of the WebApp',
        language: 'Language',
        more: {
          entry: 'Show more settings',
          copyright: 'Copyright',
          copyRightPlaceholder: 'Enter the name of the author or organization',
          privacyPolicy: 'Privacy Policy',
          privacyPolicyPlaceholder: 'Enter the privacy policy',
          privacyPolicyTip: 'Helps visitors understand the data the application collects, see Dify\'s <privacyPolicyLink>Privacy Policy</privacyPolicyLink>.',
        },
      },
      customize: {
        way: 'way',
        entry: 'Want to customize your WebApp?',
        title: 'Customize AI WebApp',
        explanation: 'You can customize the frontend of the Web App to fit your scenario and style needs.',
        way1: {
          name: 'Fork the client code, modify it and deploy to Vercel (recommended)',
          step1: 'Fork the client code and modify it',
          step1Tip: 'Click here to fork the source code into your GitHub account and modify the code',
          step1Operation: 'Dify-WebClient',
          step2: 'Configure the Web',
          step2Tip: 'Copy the Web API and APP ID,then paste them into the client code config/index.ts',
          step3: 'Deploy to Vercel',
          step3Tip: 'Click here to import the repository into Vercel and deploy',
          step3Operation: 'Import repository',
        },
        way2: {
          name: 'Write client-side code to call the API and deploy it to a server',
          operation: 'Documentation',
        },
      },
    },
    apiInfo: {
      title: 'Backend service API',
      explanation: 'Easily integrated into your application',
      accessibleAddress: 'API Token',
      doc: 'API Reference',
    },
    status: {
      running: 'In service',
      disable: 'Disable',
    },
  },
  analysis: {
    title: 'Analysis',
    ms: 'ms',
    totalMessages: {
      title: 'Total Messages',
      explanation: 'Daily AI interactions count; prompt engineering/debugging excluded.',
    },
    activeUsers: {
      title: 'Active Users',
      explanation: 'Unique users engaging in Q&A with AI; prompt engineering/debugging excluded.',
    },
    tokenUsage: {
      title: 'Token Usage',
      explanation: 'Reflects the daily token usage of the language model for the application, useful for cost control purposes.',
      consumed: 'Consumed',
    },
    avgSessionInteractions: {
      title: 'Avg. Session Interactions',
      explanation: 'Continuous user-AI communication count; for conversation-based apps.',
    },
    userSatisfactionRate: {
      title: 'User Satisfaction Rate',
      explanation: 'The number of likes per 1,000 messages. This indicates the proportion of answers that users are highly satisfied with.',
    },
    avgResponseTime: {
      title: 'Avg. Response Time',
      explanation: 'Time (ms) for AI to process/respond; for text-based apps.',
    },
  },
}

export default translation
