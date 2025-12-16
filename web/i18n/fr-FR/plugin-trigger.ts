const translation = {
  subscription: {
    title: 'Abonnements',
    listNum: 'abonnements {{num}}',
    empty: {
      title: 'Aucun abonnement',
      button: 'Nouvel abonnement',
    },
    createButton: {
      oauth: 'Nouvelle abonnement avec OAuth',
      apiKey: 'Nouvel abonnement avec clé API',
      manual: 'Collez l\'URL pour créer un nouvel abonnement',
    },
    createSuccess: 'Abonnement créé avec succès',
    createFailed: 'Échec de la création de l\'abonnement',
    maxCount: 'Nombre maximal d\'abonnements {{num}}',
    selectPlaceholder: 'Sélectionner un abonnement',
    noSubscriptionSelected: 'Aucun abonnement sélectionné',
    subscriptionRemoved: 'Abonnement supprimé',
    list: {
      title: 'Abonnements',
      addButton: 'Ajouter',
      tip: 'Recevoir des événements via abonnement',
      item: {
        enabled: 'Activé',
        disabled: 'désactivé',
        credentialType: {
          api_key: 'Clé API',
          oauth2: 'OAuth',
          unauthorized: 'Manuel',
        },
        actions: {
          delete: 'Supprimer',
          deleteConfirm: {
            title: 'Supprimer {{name}} ?',
            success: 'Abonnement {{name}} supprimé avec succès',
            error: 'Échec de la suppression de l\'abonnement {{name}}',
            content: 'Une fois supprimé, cet abonnement ne peut pas être récupéré. Veuillez confirmer.',
            contentWithApps: 'L\'abonnement actuel est référencé par {{count}} applications. Le supprimer fera en sorte que les applications configurées ne reçoivent plus d\'événements d\'abonnement.',
            confirm: 'Confirmer la suppression',
            cancel: 'Annuler',
            confirmInputWarning: 'Veuillez entrer le nom correct pour confirmer.',
            confirmInputPlaceholder: 'Entrez "{{name}}" pour confirmer.',
            confirmInputTip: 'Veuillez entrer « {{name}} » pour confirmer.',
          },
        },
        status: {
          active: 'actif',
          inactive: 'Inactif',
        },
        usedByNum: 'Utilisé par {{num}} flux de travail',
        noUsed: 'Aucun flux de travail utilisé',
      },
    },
    addType: {
      title: 'Ajouter un abonnement',
      description: 'Choisissez comment vous souhaitez créer votre abonnement de déclenchement',
      options: {
        apikey: {
          title: 'Créer avec la clé API',
          description: 'Créer automatiquement un abonnement en utilisant les identifiants API',
        },
        oauth: {
          title: 'Créer avec OAuth',
          description: 'Autoriser la plateforme tierce à créer un abonnement',
          clientSettings: 'Paramètres du client OAuth',
          clientTitle: 'Client OAuth',
          default: 'Par défaut',
          custom: 'Personnalisé',
        },
        manual: {
          title: 'Configuration manuelle',
          description: 'Collez l\'URL pour créer un nouvel abonnement',
          tip: 'Configurer l\'URL sur une plateforme tierce manuellement',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Vérifier',
      configuration: 'Configuration',
    },
    common: {
      cancel: 'Annuler',
      back: 'Retour',
      next: 'Suivant',
      create: 'Créer',
      verify: 'Vérifier',
      authorize: 'Autoriser',
      creating: 'Création...',
      verifying: 'Vérification...',
      authorizing: 'Autorisation en cours...',
    },
    oauthRedirectInfo: 'Comme aucun secret client système n\'a été trouvé pour ce fournisseur d\'outil, une configuration manuelle est requise ; pour redirect_uri, veuillez utiliser',
    apiKey: {
      title: 'Créer avec la clé API',
      verify: {
        title: 'Vérifier les identifiants',
        description: 'Veuillez fournir vos identifiants API pour vérifier l\'accès',
        error: 'Échec de la vérification des identifiants. Veuillez vérifier votre clé API.',
        success: 'Identifiants vérifiés avec succès',
      },
      configuration: {
        title: 'Configurer l\'abonnement',
        description: 'Configurez les paramètres de votre abonnement',
      },
    },
    oauth: {
      title: 'Créer avec OAuth',
      authorization: {
        title: 'Autorisation OAuth',
        description: 'Autorisez Dify à accéder à votre compte',
        redirectUrl: 'URL de redirection',
        redirectUrlHelp: 'Utilisez cette URL dans la configuration de votre application OAuth',
        authorizeButton: 'Autoriser avec {{provider}}',
        waitingAuth: 'En attente d\'autorisation...',
        authSuccess: 'Autorisation réussie',
        authFailed: 'Échec de l’obtention des informations d’autorisation OAuth',
        waitingJump: 'Autorisé, en attente du saut',
      },
      configuration: {
        title: 'Configurer l\'abonnement',
        description: 'Configurez les paramètres de votre abonnement après l\'autorisation',
        success: 'Configuration OAuth réussie',
        failed: 'Échec de la configuration OAuth',
      },
      remove: {
        success: 'Suppression d\'OAuth réussie',
        failed: 'Échec de la suppression d\'OAuth',
      },
      save: {
        success: 'Configuration OAuth enregistrée avec succès',
      },
    },
    manual: {
      title: 'Configuration manuelle',
      description: 'Configurez votre abonnement webhook manuellement',
      logs: {
        title: 'Journaux des requêtes',
        request: 'Demande',
        loading: 'En attente de la demande de {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Nom de l\'abonnement',
        placeholder: 'Entrez le nom de l\'abonnement',
        required: 'Le nom de l\'abonnement est requis',
      },
      callbackUrl: {
        label: 'URL de rappel',
        description: 'Cette URL recevra des événements webhook',
        tooltip: 'Fournissez un point de terminaison accessible publiquement qui peut recevoir des requêtes de rappel du fournisseur de déclenchement.',
        placeholder: 'Génération...',
        privateAddressWarning: 'Cette URL semble être une adresse interne, ce qui peut provoquer l\'échec des requêtes webhook. Vous pouvez changer TRIGGER_URL pour une adresse publique.',
      },
    },
    errors: {
      createFailed: 'Échec de la création de l\'abonnement',
      verifyFailed: 'Échec de la vérification des identifiants',
      authFailed: 'Autorisation échouée',
      networkError: 'Erreur réseau, veuillez réessayer',
    },
  },
  events: {
    title: 'Événements disponibles',
    description: 'Événements auxquels ce plugin de déclenchement peut s\'abonner',
    empty: 'Aucun événement disponible',
    event: 'Événement',
    events: 'Événements',
    actionNum: '{{num}} {{event}} INCLUS',
    item: {
      parameters: 'paramètres {{count}}',
      noParameters: 'Aucun paramètre',
    },
    output: 'Sortie',
  },
  node: {
    status: {
      warning: 'Se déconnecter',
    },
  },
}

export default translation
