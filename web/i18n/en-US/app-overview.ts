const translation = {
  welcome: {
    firstStepTip: 'To get started,',
    enterKeyTip: 'enter your OpenAI API Key below',
    getKeyTip: 'Get your API Key from OpenAI dashboard',
    placeholder: 'Your OpenAI API Key(eg.sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'You are using the {{providerName}} trial quota.',
        description: 'The trial quota is provided for your testing use. Before the trial quota calls are exhausted, please set up your own model provider or purchase additional quota.',
      },
      exhausted: {
        title: 'Your trial quota have been used up, please set up your APIKey.',
        description: 'Your trial quota has been exhausted. Please set up your own model provider or purchase additional quota.',
      },
    },
    selfHost: {
      title: {
        row1: 'To get started,',
        row2: 'setup your  model provider first.',
      },
    },
    callTimes: 'Call times',
    usedToken: 'Used token',
    setAPIBtn: 'Go to setup model provider',
    tryCloud: 'Or try the cloud version of Dify with free quote',
  },
  overview: {
    title: 'Overview',
    appInfo: {
      explanation: 'Ready-to-use AI WebApp',
      accessibleAddress: 'Public URL',
      preview: 'Preview',
      regenerate: 'Regenerate',
      regenerateNotice: 'Do you want to regenerate the public URL?',
      preUseReminder: 'Please enable WebApp before continuing.',
      settings: {
        entry: 'Settings',
        title: 'WebApp Settings',
        webName: 'WebApp Name',
        webDesc: 'WebApp Description',
        webDescTip: 'This text will be displayed on the client side, providing basic guidance on how to use the application',
        webDescPlaceholder: 'Enter the description of the WebApp',
        language: 'Language',
        workflow: {
          title: 'Workflow Steps',
          show: 'Show',
          hide: 'Hide',
        },
        chatColorTheme: 'Chat color theme',
        chatColorThemeDesc: 'Set the color theme of the chatbot',
        chatColorThemeInverted: 'Inverted',
        invalidHexMessage: 'Invalid hex value',
        more: {
          entry: 'Show more settings',
          copyright: 'Copyright',
          copyRightPlaceholder: 'Enter the name of the author or organization',
          privacyPolicy: 'Privacy Policy',
          privacyPolicyPlaceholder: 'Enter the privacy policy link',
          privacyPolicyTip: 'Helps visitors understand the data the application collects, see Dify\'s <privacyPolicyLink>Privacy Policy</privacyPolicyLink>.',
          customDisclaimer: 'Custom Disclaimer',
          customDisclaimerPlaceholder: 'Enter the custom disclaimer text',
          customDisclaimerTip: 'Custom disclaimer text will be displayed on the client side, providing additional information about the application',
        },
      },
      embedded: {
        entry: 'Embedded',
        title: 'Embed on website',
        explanation: 'Choose the way to embed chat app to your website',
        iframe: 'To add the chat app any where on your website, add this iframe to your html code.',
        scripts: 'To add a chat app to the bottom right of your website add this code to your html.',
        chromePlugin: 'Install Dify Chatbot Chrome Extension',
        copied: 'Copied',
        copy: 'Copy',
      },
      qrcode: {
        title: 'QR code to share',
        scan: 'Scan Share Application',
        download: 'Download QR Code',
      },
      customize: {
        way: 'way',
        entry: 'Customize',
        title: 'Customize AI WebApp',
        explanation: 'You can customize the frontend of the Web App to fit your scenario and style needs.',
        way1: {
          name: 'Fork the client code, modify it and deploy to Vercel (recommended)',
          step1: 'Fork the client code and modify it',
          step1Tip: 'Click here to fork the source code into your GitHub account and modify the code',
          step1Operation: 'Dify-WebClient',
          step2: 'Deploy to Vercel',
          step2Tip: 'Click here to import the repository into Vercel and deploy',
          step2Operation: 'Import repository',
          step3: 'Configure environment variables',
          step3Tip: 'Add the following environment variables in Vercel',
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
      accessibleAddress: 'Service API Endpoint',
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
    tokenPS: 'Token/s',
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
    avgUserInteractions: {
      title: 'Avg. User Interactions',
      explanation: 'Reflects the daily usage frequency of users. This metric reflects user stickiness.',
    },
    userSatisfactionRate: {
      title: 'User Satisfaction Rate',
      explanation: 'The number of likes per 1,000 messages. This indicates the proportion of answers that users are highly satisfied with.',
    },
    avgResponseTime: {
      title: 'Avg. Response Time',
      explanation: 'Time (ms) for AI to process/respond; for text-based apps.',
    },
    tps: {
      title: 'Token Output Speed',
      explanation: 'Measure the performance of the LLM. Count the Tokens output speed of LLM from the beginning of the request to the completion of the output.',
    },
  },
}

export default translation
