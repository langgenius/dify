const translation = {
  subscription: {
    title: 'Subscriptions',
    listNum: '{{num}} subscriptions',
    empty: {
      title: 'No subscriptions',
      button: 'New subscription',
    },
    createButton: {
      oauth: 'New subscription with OAuth',
      apiKey: 'New subscription with API Key',
      manual: 'Paste URL to create a new subscription',
    },
    createSuccess: 'Subscription created successfully',
    createFailed: 'Failed to create subscription',
    maxCount: 'Max {{num}} subscriptions',
    selectPlaceholder: 'Select subscription',
    noSubscriptionSelected: 'No subscription selected',
    subscriptionRemoved: 'Subscription removed',
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
            success: 'Subscription {{name}} deleted successfully',
            error: 'Failed to delete subscription {{name}}',
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
        apikey: {
          title: 'Create with API Key',
          description: 'Automatically create subscription using API credentials',
        },
        oauth: {
          title: 'Create with OAuth',
          description: 'Authorize with third-party platform to create subscription',
          clientSettings: 'OAuth Client Settings',
          clientTitle: 'OAuth Client',
          default: 'Default',
          custom: 'Custom',
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
      title: 'Create with API Key',
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
      title: 'Create with OAuth',
      authorization: {
        title: 'OAuth Authorization',
        description: 'Authorize Dify to access your account',
        redirectUrl: 'Redirect URL',
        redirectUrlHelp: 'Use this URL in your OAuth app configuration',
        authorizeButton: 'Authorize with {{provider}}',
        waitingAuth: 'Waiting for authorization...',
        authSuccess: 'Authorization successful',
        authFailed: 'Failed to get OAuth authorization information',
        waitingJump: 'Authorized, waiting for jump',
      },
      configuration: {
        title: 'Configure Subscription',
        description: 'Set up your subscription parameters after authorization',
        success: 'OAuth configuration successful',
        failed: 'OAuth configuration failed',
      },
      remove: {
        success: 'OAuth remove successful',
        failed: 'OAuth remove failed',
      },
      save: {
        success: 'OAuth configuration saved successfully',
      },
    },
    manual: {
      title: 'Manual Setup',
      description: 'Configure your webhook subscription manually',
      logs: {
        title: 'Request Logs',
        request: 'Request',
        loading: 'Awaiting request from {{pluginName}}...',
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
        placeholder: 'Generating...',
        privateAddressWarning: 'This URL appears to be an internal address, which may cause webhook requests to fail. You may change TRIGGER_URL to a public address.',
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
      noParameters: 'No parameters',
    },
    output: 'Output',
  },
  node: {
    status: {
      warning: 'Disconnect',
    },
  },
}

export default translation
