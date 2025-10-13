const translation = {
  category: {
    extensions: 'Extensions',
    agents: 'Stratégies des agents',
    models: 'Modèle',
    tools: 'Outils',
    bundles: 'Paquets',
    all: 'Tout',
    datasources: 'Sources des données',
  },
  categorySingle: {
    extension: 'Extension',
    tool: 'Outil',
    model: 'Modèle',
    agent: 'Stratégie d’agent',
    bundle: 'Paquet',
    datasource: 'Source des données',
  },
  list: {
    source: {
      github: 'Installer à partir de GitHub',
      local: 'Installer à partir d’un fichier de package local',
      marketplace: 'Installer à partir de Marketplace',
    },
    notFound: 'Aucun plugin trouvé',
    noInstalled: 'Aucun plugin installé',
  },
  source: {
    local: 'Fichier de package local',
    github: 'Lien avec GitHub',
    marketplace: 'Marché',
  },
  detailPanel: {
    categoryTip: {
      debugging: 'Plugin de débogage',
      local: 'Plugin local',
      github: 'Installé à partir de Github',
      marketplace: 'Installé à partir de Marketplace',
    },
    operation: {
      viewDetail: 'Voir les détails',
      info: 'Informations sur le plugin',
      checkUpdate: 'Vérifier la mise à jour',
      update: 'Mettre à jour',
      install: 'Installer',
      remove: 'Enlever',
      detail: 'Détails',
    },
    toolSelector: {
      uninstalledLink: 'Gérer dans les plugins',
      title: 'Ajouter un outil',
      uninstalledContent:
        'Ce plugin est installé à partir du référentiel local/GitHub. Veuillez utiliser après l’installation.',
      unsupportedTitle: 'Action non soutenue',
      descriptionLabel: 'Description de l’outil',
      placeholder: 'Sélectionnez un outil...',
      params: 'CONFIGURATION DE RAISONNEMENT',
      unsupportedContent:
        'La version du plugin installée ne fournit pas cette action.',
      auto: 'Auto',
      descriptionPlaceholder:
        'Brève description de l’objectif de l’outil, par exemple, obtenir la température d’un endroit spécifique.',
      unsupportedContent2: 'Cliquez pour changer de version.',
      uninstalledTitle: 'Outil non installé',
      empty:
        'Cliquez sur le bouton « + » pour ajouter des outils. Vous pouvez ajouter plusieurs outils.',
      toolLabel: 'Outil',
      settings: 'PARAMÈTRES UTILISATEUR',
      paramsTip2:
        'Lorsque « Auto » est désactivé, la valeur par défaut est utilisée.',
      paramsTip1: 'Contrôle les paramètres d’inférence LLM.',
      toolSetting: 'Paramètres de l\'outil',
      unsupportedMCPTool:
        'La version actuelle du plugin de stratégie d\'agent sélectionné ne prend pas en charge les outils MCP.',
    },
    modelNum: '{{num}} MODÈLES INCLUS',
    endpointDeleteTip: 'Supprimer le point de terminaison',
    endpoints: 'Terminaison',
    endpointsDocLink: 'Voir le document',
    switchVersion: 'Version du commutateur',
    strategyNum: '{{num}} {{stratégie}} INCLUS',
    configureTool: 'Configurer l’outil',
    endpointDeleteContent: 'Souhaitez-vous supprimer {{name}} ?',
    disabled: 'Handicapé',
    endpointsTip:
      'Ce plug-in fournit des fonctionnalités spécifiques via des points de terminaison, et vous pouvez configurer plusieurs ensembles de points de terminaison pour l’espace de travail actuel.',
    configureModel: 'Configurer le modèle',
    configureApp: 'Configurer l’application',
    endpointsEmpty:
      'Cliquez sur le bouton « + » pour ajouter un point de terminaison',
    actionNum: '{{num}} {{action}} INCLUS',
    endpointDisableContent: 'Souhaitez-vous désactiver {{name}} ?',
    endpointDisableTip: 'Désactiver le point de terminaison',
    endpointModalTitle: 'Configurer le point de terminaison',
    serviceOk: 'Service OK',
    endpointModalDesc:
      'Une fois configuré, les fonctionnalités fournies par le plugin via les points de terminaison de l’API peuvent être utilisées.',
    deprecation: {
      reason: {
        ownershipTransferred: 'propriété transférée',
        businessAdjustments: 'ajustements commerciaux',
        noMaintainer: 'aucun mainteneur',
      },
      noReason: 'Ce plugin a été abandonné et ne sera plus mis à jour.',
      onlyReason:
        'Ce plugin a été déprécié en raison de {{deprecatedReason}} et ne sera plus mis à jour.',
      fullMessage:
        'Ce plugin a été déprécié en raison de {{deprecatedReason}}, et ne sera plus mis à jour. Veuillez utiliser <CustomLink href=\'https://example.com/\'>{{-alternativePluginId}}</CustomLink> à la place.',
    },
  },
  debugInfo: {
    title: 'Débogage',
    viewDocs: 'Voir la documentation',
  },
  privilege: {
    whoCanInstall: 'Qui peut installer et gérer les plugins ?',
    admins: 'Administrateurs',
    noone: 'Personne',
    title: 'Préférences du plugin',
    everyone: 'Tout le monde',
    whoCanDebug: 'Qui peut déboguer les plugins ?',
  },
  pluginInfoModal: {
    release: 'Libérer',
    title: 'Informations sur le plugin',
    packageName: 'Colis',
    repository: 'Dépôt',
  },
  action: {
    checkForUpdates: 'Rechercher des mises à jour',
    pluginInfo: 'Informations sur le plugin',
    delete: 'Supprimer le plugin',
    deleteContentLeft: 'Souhaitez-vous supprimer',
    deleteContentRight: 'Plug-in ?',
    usedInApps: 'Ce plugin est utilisé dans les applications {{num}}.',
  },
  installModal: {
    labels: {
      package: 'Colis',
      version: 'Version',
      repository: 'Dépôt',
    },
    installedSuccessfullyDesc: 'Le plugin a été installé avec succès.',
    uploadingPackage: 'Téléchargement de {{packageName}}...',
    readyToInstallPackage: 'Sur le point d’installer le plugin suivant',
    back: 'Précédent',
    fromTrustSource:
      'Assurez-vous de n’installer que des plugins provenant d’une <trustSource>source fiable</trustSource>.',
    close: 'Fermer',
    installing: 'Installation...',
    pluginLoadErrorDesc: 'Ce plugin ne sera pas installé',
    cancel: 'Annuler',
    installFailed: 'Échec de l’installation',
    readyToInstallPackages:
      'Sur le point d’installer les plugins {{num}} suivants',
    install: 'Installer',
    uploadFailed: 'Échec du téléchargement',
    installComplete: 'Installation terminée',
    pluginLoadError: 'Erreur de chargement du plugin',
    dropPluginToInstall: 'Déposez le package de plugin ici pour l’installer',
    readyToInstall: 'Sur le point d’installer le plugin suivant',
    installedSuccessfully: 'Installation réussie',
    next: 'Prochain',
    installPlugin: 'Installer le plugin',
    installFailedDesc: 'L’installation du plug-in a échoué.',
    installWarning: 'Ce plugin n’est pas autorisé à être installé.',
  },
  installFromGitHub: {
    installFailed: 'Échec de l’installation',
    installPlugin: 'Installer le plugin depuis GitHub',
    gitHubRepo: 'Référentiel GitHub',
    selectPackage: 'Sélectionnez le forfait',
    selectVersion: 'Sélectionner la version',
    uploadFailed: 'Échec du téléchargement',
    installNote:
      'Assurez-vous de n’installer que des plugins provenant d’une source fiable.',
    selectVersionPlaceholder: 'Veuillez sélectionner une version',
    installedSuccessfully: 'Installation réussie',
    updatePlugin: 'Mettre à jour le plugin à partir de GitHub',
    selectPackagePlaceholder: 'Veuillez sélectionner un forfait',
  },
  upgrade: {
    upgrading: 'Installation...',
    usedInApps: 'Utilisé dans les applications {{num}}',
    close: 'Fermer',
    description: 'Sur le point d’installer le plugin suivant',
    upgrade: 'Installer',
    title: 'Installer le plugin',
    successfulTitle: 'Installation réussie',
  },
  error: {
    noReleasesFound:
      'Aucune version n’a été trouvée. Vérifiez le référentiel GitHub ou l’URL d’entrée.',
    inValidGitHubUrl:
      'URL GitHub non valide. Entrez une URL valide au format : https://github.com/owner/repo',
    fetchReleasesError:
      'Impossible de récupérer les versions. Veuillez réessayer plus tard.',
  },
  marketplace: {
    sortOption: {
      firstReleased: 'Première sortie',
      mostPopular: 'Les plus populaires',
      recentlyUpdated: 'Récemment mis à jour',
      newlyReleased: 'Nouvellement publié',
    },
    noPluginFound: 'Aucun plugin trouvé',
    moreFrom: 'Plus de Marketplace',
    and: 'et',
    viewMore: 'Voir plus',
    pluginsResult: '{{num}} résultats',
    discover: 'Découvrir',
    difyMarketplace: 'Marché Dify',
    empower: 'Renforcez le développement de votre IA',
    sortBy: 'Ville noire',
    partnerTip: 'Vérifié par un partenaire Dify',
    verifiedTip: 'Vérifié par Dify',
  },
  task: {
    installError:
      '{{errorLength}} les plugins n’ont pas pu être installés, cliquez pour voir',
    installingWithSuccess:
      'Installation des plugins {{installingLength}}, succès de {{successLength}}.',
    installingWithError:
      'Installation des plugins {{installingLength}}, succès de {{successLength}}, échec de {{errorLength}}',
    installedError: '{{errorLength}} les plugins n’ont pas pu être installés',
    clearAll: 'Effacer tout',
    installing: 'Installation des plugins {{installingLength}}, 0 fait.',
  },
  search: 'Rechercher',
  installAction: 'Installer',
  from: 'De',
  searchCategories: 'Catégories de recherche',
  searchPlugins: 'Rechercher des plugins',
  fromMarketplace: 'À partir de Marketplace',
  findMoreInMarketplace: 'En savoir plus sur Marketplace',
  install: '{{num}} s’installe',
  installFrom: 'INSTALLER À PARTIR DE',
  searchInMarketplace: 'Rechercher sur Marketplace',
  allCategories: 'Toutes les catégories',
  endpointsEnabled: '{{num}} ensembles de points de terminaison activés',
  searchTools: 'Outils de recherche...',
  installPlugin: 'Installer le plugin',
  metadata: {
    title: 'Plugins',
  },
  difyVersionNotCompatible:
    'La version actuelle de Dify n\'est pas compatible avec ce plugin, veuillez mettre à niveau vers la version minimale requise : {{minimalDifyVersion}}',
  requestAPlugin: 'Demander un plugin',
  publishPlugins: 'Publier des plugins',
  auth: {
    oauthClient: 'Client OAuth',
    authorizationName: 'Nom d\'autorisation',
    authorizations: 'Autorisations',
    workspaceDefault: 'Espace de travail par défaut',
    default: 'Par défaut',
    addOAuth: 'Ajouter OAuth',
    saveAndAuth: 'Enregistrer et autoriser',
    custom: 'Personnalisé',
    authRemoved: 'Autorisation retirée',
    saveOnly: 'Sauvegarder seulement',
    setupOAuth: 'Configurer le client OAuth',
    useApiAuth: 'Configuration de l\'autorisation de clé API',
    addApi: 'Ajouter une clé API',
    useOAuth: 'Utilisez OAuth',
    oauthClientSettings: 'Paramètres du client OAuth',
    useOAuthAuth: 'Utilisez l\'autorisation OAuth',
    useApiAuthDesc:
      'Après avoir configuré les identifiants, tous les membres de l\'espace de travail peuvent utiliser cet outil lors de l\'orchestration des applications.',
    clientInfo:
      'Comme aucun secret client du système n\'a été trouvé pour ce fournisseur d\'outils, une configuration manuelle est requise. Pour redirect_uri, veuillez utiliser',
    setDefault: 'Définir comme par défaut',
    authorization: 'Autorisation',
    useApi: 'Utilisez la clé API',
    customCredentialUnavailable:
      'Les identifiants personnalisés ne sont actuellement pas disponibles.',
    credentialUnavailable:
      'Les informations d\'identification ne sont actuellement pas disponibles. Veuillez contacter l\'administrateur.',
    unavailable: 'Non disponible',
    credentialUnavailableInButton: 'Identifiant indisponible',
    connectedWorkspace: 'Espace de travail connecté',
    emptyAuth: 'Veuillez configurer l’authentification',
  },
  deprecated: 'Obsolète',
  autoUpdate: {
    strategy: {
      disabled: {
        description: 'Les plugins ne se mettront pas à jour automatiquement',
        name: 'désactivé',
      },
      fixOnly: {
        selectedDescription:
          'Mise à jour automatique uniquement pour les versions de correctif',
        name: 'Réparer seulement',
        description:
          'Mise à jour automatique uniquement pour les versions de correctif (par exemple, 1.0.1 → 1.0.2). Les changements de version mineure ne déclencheront pas de mises à jour.',
      },
      latest: {
        name: 'Dernier',
        selectedDescription: 'Mettez toujours à jour vers la dernière version',
        description: 'Mettez toujours à jour vers la dernière version',
      },
    },
    upgradeMode: {
      exclude: 'Exclure sélectionné',
      all: 'Mettre à jour tout',
      partial: 'Seulement sélectionné',
    },
    upgradeModePlaceholder: {
      partial:
        'Seuls les plugins sélectionnés se mettront à jour automatiquement. Aucun plugin n\'est actuellement sélectionné, donc aucun plugin ne se mettra à jour automatiquement.',
      exclude:
        'Les plugins sélectionnés ne se mettront pas à jour automatiquement.',
    },
    operation: {
      clearAll: 'Tout effacer',
      select: 'Sélectionner des plugins',
    },
    pluginDowngradeWarning: {
      title: 'Baisse de version du plugin',
      exclude: 'Exclure de la mise à jour automatique',
      downgrade: 'Dégradez de toute façon',
      description:
        'La mise à jour automatique est actuellement activée pour ce plugin. Le fait de rétrograder la version peut entraîner la perte de vos modifications lors de la prochaine mise à jour automatique.',
    },
    noPluginPlaceholder: {
      noInstalled: 'Aucun plugin installé',
      noFound: 'Aucun plugin n\'a été trouvé',
    },
    updateTime: 'Temps de mise à jour',
    specifyPluginsToUpdate: 'Spécifiez les plugins à mettre à jour',
    updateTimeTitle: 'Temps de mise à jour',
    changeTimezone:
      'Pour changer de fuseau horaire, allez dans <setTimezone>Paramètres</setTimezone>',
    automaticUpdates: 'Mises à jour automatiques',
    updateSettings: 'Mettre à jour les paramètres',
    excludeUpdate:
      'Les {{num}} plugins suivants ne se mettront pas à jour automatiquement',
    partialUPdate:
      'Seuls les {{num}} plugins suivants se mettront à jour automatiquement',
    nextUpdateTime: 'Prochaine mise à jour automatique : {{time}}',
  },
}

export default translation
