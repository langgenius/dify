const translation = {
  welcome: {
    firstStepTip: 'Pour commencer,',
    enterKeyTip: 'saisissez votre clé API OpenAI ci-dessous',
    getKeyTip: 'Obtenez votre clé API depuis le tableau de bord OpenAI',
    placeholder: 'Votre clé API OpenAI (ex. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Vous utilisez le quota d\'essai de {{providerName}}.',
        description: 'Le quota d\'essai est fourni pour votre usage de test. Avant l\'épuisement des appels de quota d\'essai, veuillez configurer votre propre fournisseur de modèle ou acheter un quota supplémentaire.',
      },
      exhausted: {
        title: 'Votre quota d\'essai a été utilisé, veuillez configurer votre clé API.',
        description: 'Votre quota d\'essai a été épuisé. Veuillez configurer votre propre fournisseur de modèle ou acheter un quota supplémentaire.',
      },
    },
    selfHost: {
      title: {
        row1: 'Pour commencer,',
        row2: 'configurez d\'abord votre fournisseur de modèle.',
      },
    },
    callTimes: 'Appels',
    usedToken: 'Token utilisés',
    setAPIBtn: 'Aller à la configuration du fournisseur de modèle',
    tryCloud: 'Ou essayez la version cloud de Dify avec un devis gratuit',
  },
  overview: {
    title: 'Aperçu',
    appInfo: {
      explanation: 'WebApp AI prête à l\'emploi',
      accessibleAddress: 'URL publique',
      preview: 'Aperçu',
      regenerate: 'Regénérer',
      regenerateNotice: 'Voulez-vous régénérer l\'URL publique ?',
      preUseReminder: 'Veuillez activer WebApp avant de continuer.',
      settings: {
        entry: 'Paramètres',
        title: 'Paramètres de l\'application Web',
        webName: 'Nom de l\'application Web',
        webDesc: 'Description de l\'application Web',
        webDescTip: 'Ce texte sera affiché côté client, fournissant des directives de base sur la façon d\'utiliser l\'application',
        webDescPlaceholder: 'Entrez la description de l\'application Web',
        language: 'Langue',
        workflow: {
          title: 'Étapes du workflow',
          show: 'Afficher',
          hide: 'Masquer',
        },
        more: {
          entry: 'Afficher plus de paramètres',
          copyright: 'Droits d\'auteur',
          copyRightPlaceholder: 'Entrez le nom de l\'auteur ou de l\'organisation',
          privacyPolicy: 'Politique de confidentialité',
          privacyPolicyPlaceholder: 'Entrez le lien de la politique de confidentialité',
          privacyPolicyTip: 'Aide les visiteurs à comprendre les données collectées par l\'application, voir la <privacyPolicyLink>Politique de confidentialité</privacyPolicyLink> de Dify.',
          customDisclaimer: 'Clause de non-responsabilité personnalisée',
          customDisclaimerPlaceholder: 'Entrez le texte de la clause de non-responsabilité personnalisée',
          customDisclaimerTip: 'Le texte de la clause de non-responsabilité personnalisée sera affiché côté client, fournissant des informations supplémentaires sur l\'application',
        },
      },
      embedded: {
        entry: 'Intégré',
        title: 'Intégrer sur un site Web',
        explanation: 'Choisissez la manière d\'intégrer l\'application de chat à votre site Web',
        iframe: 'Pour ajouter l\'application de chat n\'importe où sur votre site Web, ajoutez cette iframe à votre code HTML.',
        scripts: 'Pour ajouter une application de chat en bas à droite de votre site Web, ajoutez ce code à votre HTML.',
        chromePlugin: 'Installer l\'extension Chrome Dify Chatbot',
        copied: 'Copié',
        copy: 'Copier',
      },
      qrcode: {
        title: 'QR code à partager',
        scan: 'Scanner et partager l\'application',
        download: 'Télécharger le code QR',
      },
      customize: {
        way: 'façon',
        entry: 'Personnaliser',
        title: 'Personnaliser l\'application Web AI',
        explanation: 'Vous pouvez personnaliser l\'interface utilisateur de l\'application Web pour répondre à vos besoins de scénario et de style.',
        way1: {
          name: 'Faire une copie du code client, le modifier et le déployer sur Vercel (recommandé)',
          step1: 'Faire une copie du code client et le modifier',
          step1Tip: 'Cliquez ici pour faire une copie du code source dans votre compte GitHub et le modifier',
          step1Operation: 'Client-Web-Dify',
          step2: 'Déployer sur Vercel',
          step2Tip: 'Cliquez ici pour importer le dépôt dans Vercel et le déployer',
          step2Operation: 'Importer le dépôt',
          step3: 'Configurer les variables d\'environnement',
          step3Tip: 'Ajoutez les variables d\'environnement suivantes dans Vercel',
        },
        way2: {
          name: 'Écrire du code côté client pour appeler l\'API et le déployer sur un serveur',
          operation: 'Documentation',
        },
      },
    },
    apiInfo: {
      title: 'API de service Backend',
      explanation: 'Facilement intégré dans votre application',
      accessibleAddress: 'Point de terminaison du service API',
      doc: 'Référence de l\'API',
    },
    status: {
      running: 'En service',
      disable: 'Désactiver',
    },
  },
  analysis: {
    title: 'Analyse',
    ms: 'ms',
    tokenPS: 'Token/s',
    totalMessages: {
      title: 'Total des messages',
      explanation: 'Nombre d\'interactions quotidiennes avec l\'IA ; l\'ingénierie/le débogage des prompts sont exclus.',
    },
    activeUsers: {
      title: 'Utilisateurs actifs',
      explanation: 'Utilisateurs uniques engagés dans des Q&R avec l\'IA ; l\'ingénierie/le débogage des prompts sont exclus.',
    },
    tokenUsage: {
      title: 'Utilisation des tokens',
      explanation: 'Reflet de l\'utilisation quotidienne des tokens du modèle de langue pour l\'application, utile pour le contrôle des coûts.',
      consumed: 'Consommé',
    },
    avgSessionInteractions: {
      title: 'Interactions moyennes par session',
      explanation: 'Nombre de communications continu utilisateur-IA ; pour les applications basées sur la conversation.',
    },
    avgUserInteractions: {
      title: 'Interactions moyennes par utilisateur',
      explanation: 'Reflet de la fréquence d\'utilisation quotidienne des utilisateurs. Cette métrique reflète la fidélité des utilisateurs.',
    },
    userSatisfactionRate: {
      title: 'Taux de satisfaction des utilisateurs',
      explanation: 'Le nombre de likes parmi 1 000 messages. Cela indique la proportion de réponses avec lesquelles les utilisateurs sont très satisfaits.',
    },
    avgResponseTime: {
      title: 'Temps de réponse moyen',
      explanation: 'Temps (ms) pour l\'IA pour traiter/répondre ; pour les applications basées sur du texte.',
    },
    tps: {
      title: 'Vitesse de sortie de token',
      explanation: 'Mesurer les performances du LLM. Compter la vitesse de sortie des tokens du LLM depuis le début de la requête jusqu\'à l\'achèvement de la sortie.',
    },
  },
}

export default translation
