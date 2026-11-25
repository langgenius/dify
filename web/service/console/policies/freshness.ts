import type { ConsolePolicies } from './types'

/**
 * Read freshness that differs from the QueryClient default (`staleTime` five
 * minutes), set once per procedure instead of at every call site.
 *
 * - `staleTime: 0` reads always revalidate on mount: credential and secret forms,
 *   download URLs, validity checks, run lists, and drafts another tab may change.
 * - `gcTime: 0` also drops the cache once unused, so a reopened form or picker
 *   starts from the server instead of showing the previous value first.
 * - `staleTime: Infinity` reads never change while the page is open.
 *
 * A call site may still override these for a screen that needs something else.
 */
export const freshnessPolicies: ConsolePolicies = {
  account: {
    personalAccessTokens: {
      byTokenId: {
        get: {
          queryOptions: { staleTime: 0 },
        },
      },
    },
  },
  explore: {
    apps: {
      byAppId: {
        get: {
          queryOptions: { staleTime: 0 },
        },
      },
    },
  },
  enterprise: {
    appDeploy: {
      deploymentService: {
        precheckWorkflowDeployment: {
          queryOptions: { gcTime: 0 },
        },
        getWorkflowDeploymentOptions: {
          queryOptions: { gcTime: 0 },
        },
      },
    },
    webAppAuth: {
      getWebAppWhitelistSubjects: {
        queryOptions: { staleTime: 0, gcTime: 0 },
      },
      searchForWhilteListCandidates: {
        infiniteOptions: { gcTime: 0, staleTime: 0 },
      },
    },
  },
  apps: {
    byAppId: {
      workflows: {
        draft: {
          environmentVariables: {
            get: {
              queryOptions: { staleTime: 0 },
            },
          },
        },
        triggers: {
          webhook: {
            get: {
              queryOptions: { staleTime: 0 },
            },
          },
        },
        defaultWorkflowBlockConfigs: {
          get: {
            queryOptions: { staleTime: 0 },
          },
        },
      },
      export: {
        get: {
          queryOptions: { staleTime: 0, gcTime: 0 },
        },
      },
      chatMessages: {
        byMessageId: {
          suggestedQuestions: {
            get: {
              queryOptions: { staleTime: 0 },
            },
          },
        },
      },
      conversationVariables: {
        get: {
          queryOptions: { staleTime: 0 },
        },
      },
      agent: {
        config: {
          files: {
            byName: {
              download: {
                get: {
                  queryOptions: { staleTime: 0 },
                },
              },
            },
          },
          skills: {
            byName: {
              download: {
                get: {
                  queryOptions: { staleTime: 0 },
                },
              },
              files: {
                download: {
                  get: {
                    queryOptions: { staleTime: 0 },
                  },
                },
              },
            },
          },
        },
      },
      advancedChat: {
        workflowRuns: {
          get: {
            queryOptions: { staleTime: 0 },
          },
        },
      },
      workflowRuns: {
        get: {
          queryOptions: { staleTime: 0 },
        },
      },
    },
  },
  datasets: {
    byDatasetId: {
      useCheck: {
        get: {
          queryOptions: { staleTime: 0 },
        },
      },
    },
    externalKnowledgeApi: {
      byExternalKnowledgeApiId: {
        useCheck: {
          get: {
            queryOptions: { gcTime: 0, staleTime: 0 },
          },
        },
      },
    },
  },
  byEvaluateTargetType: {
    byEvaluateTargetId: {
      evaluation: {
        nodeInfo: {
          post: {
            queryOptions: { refetchOnMount: 'always' },
          },
        },
      },
    },
  },
  workspaces: {
    current: {
      modelProviders: {
        byProvider: {
          credentials: {
            get: {
              queryOptions: { staleTime: 0, gcTime: 0 },
            },
          },
          models: {
            credentials: {
              get: {
                queryOptions: { staleTime: 0, gcTime: 0 },
              },
            },
          },
        },
      },
      humanInput: {
        v2: {
          contactOptions: {
            batch: {
              get: {
                queryOptions: { staleTime: 0 },
              },
            },
          },
          imSyncRuns: {
            latest: {
              results: {
                get: {
                  queryOptions: { staleTime: 0 },
                },
              },
            },
          },
          organizationCandidates: {
            get: {
              queryOptions: { staleTime: 30_000 },
            },
          },
          contacts: {
            batch: {
              get: {
                queryOptions: { staleTime: 30_000 },
              },
            },
          },
        },
      },
      networkAccessGroups: {
        byGroupId: {
          checkCurrentIp: {
            get: {
              queryOptions: { staleTime: 0 },
            },
          },
        },
        currentIp: {
          get: {
            queryOptions: { staleTime: 0, gcTime: 0 },
          },
        },
      },
      toolProvider: {
        builtin: {
          byProvider: {
            credential: {
              info: {
                get: {
                  queryOptions: { staleTime: 0 },
                },
              },
            },
            oauth: {
              clientSchema: {
                get: {
                  queryOptions: { staleTime: 0 },
                },
              },
            },
          },
        },
      },
      plugin: {
        parameters: {
          dynamicOptionsWithCredentials: {
            post: {
              queryOptions: { staleTime: 0 },
            },
          },
          dynamicOptions: {
            get: {
              queryOptions: { staleTime: 0 },
            },
          },
        },
      },
    },
  },
  rag: {
    pipelines: {
      byPipelineId: {
        workflows: {
          defaultWorkflowBlockConfigs: {
            get: {
              queryOptions: { staleTime: 0 },
            },
          },
        },
        workflowRuns: {
          get: {
            queryOptions: { staleTime: 0 },
          },
        },
      },
    },
  },
  agent: {
    inviteOptions: {
      get: {
        // Returning to a filter starts on page one, even if more pages were loaded before.
        infiniteOptions: { gcTime: 0, staleTime: 0 },
      },
    },
    byAgentId: {
      config: {
        files: {
          byName: {
            download: {
              get: {
                queryOptions: { staleTime: 0 },
              },
            },
          },
        },
        skills: {
          byName: {
            download: {
              get: {
                queryOptions: { staleTime: 0 },
              },
            },
            files: {
              download: {
                get: {
                  queryOptions: { staleTime: 0 },
                },
              },
            },
          },
        },
      },
    },
  },
  appDslVersion: {
    get: {
      queryOptions: { staleTime: Infinity },
    },
  },
  trialApps: {
    byAppId: {
      agent: {
        config: {
          files: {
            byName: {
              download: {
                get: {
                  queryOptions: { staleTime: 0 },
                },
              },
            },
          },
          skills: {
            byName: {
              download: {
                get: {
                  queryOptions: { staleTime: 0 },
                },
              },
              files: {
                download: {
                  get: {
                    queryOptions: { staleTime: 0 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  form: {
    humanInput: {
      v2: {
        byFormToken: {
          get: {
            queryOptions: { staleTime: 0, gcTime: 0 },
          },
        },
      },
    },
  },
  knowledgeFs: {
    features: {
      get: {
        queryOptions: { staleTime: Infinity },
      },
    },
    spaces: {
      byControlSpaceId: {
        settings: {
          migrations: {
            byMigrationId: {
              get: {
                queryOptions: { staleTime: 0 },
              },
            },
          },
        },
        metadata: {
          get: {
            queryOptions: { staleTime: 30_000 },
          },
        },
      },
    },
  },
  snippets: {
    bySnippetId: {
      workflowRuns: {
        get: {
          queryOptions: { staleTime: 0 },
        },
      },
    },
  },
}
