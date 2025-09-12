const translation = {
  subscription: {
    title: 'Subscriptions',
    listNum: '{{num}} subscriptions',
    empty: {
      title: 'No subscriptions',
      description: 'Create your first subscription to start receiving events',
      button: 'New subscription',
    },
    list: {
      title: 'Subscriptions',
      addButton: 'Add',
      item: {
        enabled: 'Enabled',
        disabled: 'Disabled',
        credentialType: {
          api_key: 'API Key',
          oauth2: 'OAuth',
          unauthorized: 'Manual',
        },
        actions: {
          delete: 'Delete',
          deleteConfirm: {
            title: 'Delete subscription',
            content: 'Are you sure you want to delete "{{name}}"?',
            contentWithApps: 'This subscription is being used in {{count}} apps. Are you sure you want to delete "{{name}}"?',
            confirm: 'Delete',
            cancel: 'Cancel',
          },
        },
        status: {
          active: 'Active',
          inactive: 'Inactive',
        },
      },
    },
    addType: {
      title: 'Add subscription',
      description: 'Choose how you want to create your trigger subscription',
      options: {
        apiKey: {
          title: 'Via API Key',
          description: 'Automatically create subscription using API credentials',
        },
        oauth: {
          title: 'Via OAuth',
          description: 'Authorize with third-party platform to create subscription',
        },
        manual: {
          title: 'Manual Setup',
          description: 'Manually configure webhook URL and settings',
          tip: 'Configure URL on third-party platform manually',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Verify',
      configuration: 'Configuration',
    },
    common: {
      cancel: 'Cancel',
      back: 'Back',
      next: 'Next',
      create: 'Create',
      verify: 'Verify',
      authorize: 'Authorize',
      creating: 'Creating...',
      verifying: 'Verifying...',
      authorizing: 'Authorizing...',
    },
    apiKey: {
      title: 'Create via API Key',
      verify: {
        title: 'Verify Credentials',
        description: 'Please provide your API credentials to verify access',
        error: 'Credential verification failed. Please check your API key.',
        success: 'Credentials verified successfully',
      },
      configuration: {
        title: 'Configure Subscription',
        description: 'Set up your subscription parameters',
      },
    },
    oauth: {
      title: 'Create via OAuth',
      authorization: {
        title: 'OAuth Authorization',
        description: 'Authorize Dify to access your account',
        redirectUrl: 'Redirect URL',
        redirectUrlHelp: 'Use this URL in your OAuth app configuration',
        authorizeButton: 'Authorize with {{provider}}',
        waitingAuth: 'Waiting for authorization...',
        authSuccess: 'Authorization successful',
        authFailed: 'Authorization failed',
      },
      configuration: {
        title: 'Configure Subscription',
        description: 'Set up your subscription parameters after authorization',
      },
    },
    manual: {
      title: 'Manual Setup',
      description: 'Configure your webhook subscription manually',
      instruction: {
        title: 'Setup Instructions',
        step1: '1. Copy the callback URL below',
        step2: '2. Go to your third-party platform webhook settings',
        step3: '3. Add the callback URL as a webhook endpoint',
        step4: '4. Configure the events you want to receive',
        step5: '5. Test the webhook by triggering an event',
        step6: '6. Return here to verify the webhook is working and complete setup',
      },
      logs: {
        title: 'Request Logs',
        description: 'Monitor incoming webhook requests',
        empty: 'No requests received yet. Make sure to test your webhook configuration.',
        status: {
          success: 'Success',
          error: 'Error',
        },
        expandAll: 'Expand All',
        collapseAll: 'Collapse All',
        timestamp: 'Timestamp',
        method: 'Method',
        path: 'Path',
        headers: 'Headers',
        body: 'Body',
        response: 'Response',
      },
    },
    form: {
      subscriptionName: {
        label: 'Subscription Name',
        placeholder: 'Enter subscription name',
        required: 'Subscription name is required',
      },
      callbackUrl: {
        label: 'Callback URL',
        description: 'This URL will receive webhook events',
        copy: 'Copy',
        copied: 'Copied!',
      },
    },
    errors: {
      createFailed: 'Failed to create subscription',
      verifyFailed: 'Failed to verify credentials',
      authFailed: 'Authorization failed',
      networkError: 'Network error, please try again',
    },
  },
  events: {
    title: 'Available Events',
    description: 'Events that this trigger plugin can subscribe to',
    empty: 'No events available',
    actionNum: '{{num}} {{event}} INCLUDED',
    item: {
      parameters: '{{count}} parameters',
    },
  },
  provider: {
    github: 'GitHub',
    gitlab: 'GitLab',
    notion: 'Notion',
    webhook: 'Webhook',
  },
}

export default translation
