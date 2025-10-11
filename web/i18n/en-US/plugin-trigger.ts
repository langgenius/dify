const translation = {
  subscription: {
    title: 'Subscriptions',
    listNum: '{{num}} subscriptions',
    empty: {
      title: 'No subscriptions',
      description: 'Create your first subscription to start receiving events',
      button: 'New subscription',
    },
    createButton: {
      oauth: 'New subscription with OAuth',
      apiKey: 'New subscription with API Key',
      manual: 'Paste URL to create a new subscription',
    },
    list: {
      title: 'Subscriptions',
      addButton: 'Add',
      tip: 'Receive events via Subscription',
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
            title: 'Delete {{name}}?',
            content: 'Once deleted, this subscription cannot be recovered. Please confirm.',
            contentWithApps: 'The current subscription is referenced by {{count}} applications. Deleting it will cause the configured applications to stop receiving subscription events.',
            confirm: 'Confirm Delete',
            cancel: 'Cancel',
            confirmInputWarning: 'Please enter the correct name to confirm.',
            confirmInputPlaceholder: 'Enter "{{name}}" to confirm.',
            confirmInputTip: 'Please enter “{{name}}” to confirm.',
          },
        },
        status: {
          active: 'Active',
          inactive: 'Inactive',
        },
        usedByNum: 'Used by {{num}} workflows',
        noUsed: 'No workflow used',
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
          description: 'Paste URL to create a new subscription',
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
    oauthRedirectInfo: 'As no system client secrets found for this tool provider, setup it manually is required, for redirect_uri, please use',
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
        waitingJump: 'Authorized, waiting for jump',
      },
      configuration: {
        title: 'Configure Subscription',
        description: 'Set up your subscription parameters after authorization',
        success: 'OAuth configuration successful',
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
        tooltip: 'Provide a publicly accessible endpoint that can receive callback requests from the trigger provider.',
        placeholder: 'https://example.com/webhooks/github',
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
    event: 'Event',
    events: 'Events',
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
