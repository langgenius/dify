const translation = {
  subscription: {
    title: 'Abonnements',
    listNum: '{{num}} Abonnements',
    empty: {
      title: 'Keine Abonnements',
      button: 'Neues Abonnement',
    },
    createButton: {
      oauth: 'Neue Anmeldung mit OAuth',
      apiKey: 'Neues Abonnement mit API-Schlüssel',
      manual: 'URL einfügen, um ein neues Abonnement zu erstellen',
    },
    createSuccess: 'Abonnement erfolgreich erstellt',
    createFailed: 'Fehler beim Erstellen des Abonnements',
    maxCount: 'Max {{num}} Abonnements',
    selectPlaceholder: 'Abonnement auswählen',
    noSubscriptionSelected: 'Kein Abonnement ausgewählt',
    subscriptionRemoved: 'Abonnement entfernt',
    list: {
      title: 'Abonnements',
      addButton: 'Hinzufügen',
      tip: 'Ereignisse über ein Abonnement empfangen',
      item: {
        enabled: 'Aktiviert',
        disabled: 'Deaktiviert',
        credentialType: {
          api_key: 'API-Schlüssel',
          oauth2: 'OAuth',
          unauthorized: 'Handbuch',
        },
        actions: {
          delete: 'Löschen',
          deleteConfirm: {
            title: '„{{name}} löschen?“',
            success: 'Abonnement {{name}} erfolgreich gelöscht',
            error: 'Löschen des Abonnements {{name}} fehlgeschlagen',
            content: 'Einmal gelöscht, kann dieses Abonnement nicht wiederhergestellt werden. Bitte bestätigen Sie.',
            contentWithApps: 'Das aktuelle Abonnement wird von {{count}} Anwendungen referenziert. Wenn es gelöscht wird, werden die konfigurierten Anwendungen keine Abonnementereignisse mehr erhalten.',
            confirm: 'Löschen bestätigen',
            cancel: 'Abbrechen',
            confirmInputWarning: 'Bitte geben Sie den korrekten Namen zur Bestätigung ein.',
            confirmInputPlaceholder: 'Geben Sie "{{name}}" ein, um zu bestätigen.',
            confirmInputTip: 'Bitte geben Sie „{{name}}“ zur Bestätigung ein.',
          },
        },
        status: {
          active: 'Aktiv',
          inactive: 'Inaktiv',
        },
        usedByNum: 'Verwendet von {{num}} Workflows',
        noUsed: 'Kein Workflow verwendet',
      },
    },
    addType: {
      title: 'Abonnement hinzufügen',
      description: 'Wählen Sie aus, wie Sie Ihr Trigger-Abonnement erstellen möchten',
      options: {
        apikey: {
          title: 'Mit API-Schlüssel erstellen',
          description: 'Abonnement automatisch mit API-Zugangsdaten erstellen',
        },
        oauth: {
          title: 'Erstellen Sie mit OAuth',
          description: 'Bei einer Drittanbieterplattform autorisieren, um ein Abonnement zu erstellen',
          clientSettings: 'OAuth-Client-Einstellungen',
          clientTitle: 'OAuth-Client',
          default: 'Standard',
          custom: 'Benutzerdefiniert',
        },
        manual: {
          title: 'Manuelle Einrichtung',
          description: 'URL einfügen, um ein neues Abonnement zu erstellen',
          tip: 'URL auf einer Drittanbieterplattform manuell konfigurieren',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Überprüfen',
      configuration: 'Konfiguration',
    },
    common: {
      cancel: 'Abbrechen',
      back: 'Zurück',
      next: 'Weiter',
      create: 'Erstellen',
      verify: 'Überprüfen',
      authorize: 'Autorisieren',
      creating: 'Erstellen...',
      verifying: 'Überprüfen...',
      authorizing: 'Autorisierung läuft...',
    },
    oauthRedirectInfo: 'Da für diesen Toolanbieter keine System-Client-Geheimnisse gefunden wurden, ist eine manuelle Einrichtung erforderlich. Für redirect_uri verwenden Sie bitte',
    apiKey: {
      title: 'Mit API-Schlüssel erstellen',
      verify: {
        title: 'Anmeldeinformationen überprüfen',
        description: 'Bitte geben Sie Ihre API-Zugangsdaten ein, um den Zugriff zu überprüfen',
        error: 'Überprüfung der Anmeldedaten fehlgeschlagen. Bitte überprüfen Sie Ihren API-Schlüssel.',
        success: 'Anmeldedaten erfolgreich überprüft',
      },
      configuration: {
        title: 'Abonnement konfigurieren',
        description: 'Richten Sie Ihre Abonnementparameter ein',
      },
    },
    oauth: {
      title: 'Mit OAuth erstellen',
      authorization: {
        title: 'OAuth-Autorisierung',
        description: 'Erlaube Dify den Zugriff auf dein Konto',
        redirectUrl: 'Weiterleitungs-URL',
        redirectUrlHelp: 'Verwenden Sie diese URL in der Konfiguration Ihrer OAuth-App',
        authorizeButton: 'Autorisieren mit {{provider}}',
        waitingAuth: 'Warten auf die Autorisierung...',
        authSuccess: 'Autorisierung erfolgreich',
        authFailed: 'Fehler beim Abrufen der OAuth-Autorisierungsinformationen',
        waitingJump: 'Autorisierte, warten auf den Sprung',
      },
      configuration: {
        title: 'Abonnement konfigurieren',
        description: 'Richten Sie Ihre Abonnementparameter nach der Autorisierung ein',
        success: 'OAuth-Konfiguration erfolgreich',
        failed: 'OAuth-Konfiguration fehlgeschlagen',
      },
      remove: {
        success: 'OAuth erfolgreich entfernt',
        failed: 'OAuth-Entfernung fehlgeschlagen',
      },
      save: {
        success: 'OAuth-Konfiguration erfolgreich gespeichert',
      },
    },
    manual: {
      title: 'Manuelle Einrichtung',
      description: 'Konfigurieren Sie Ihr Webhook-Abonnement manuell',
      logs: {
        title: 'Anforderungsprotokolle',
        request: 'Anfrage',
        loading: 'Warten auf Anfrage von {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Abonnementname',
        placeholder: 'Abonnementname eingeben',
        required: 'Der Abonnementname ist erforderlich',
      },
      callbackUrl: {
        label: 'Rückruf-URL',
        description: 'Diese URL wird Webhook-Ereignisse empfangen',
        tooltip: 'Stellen Sie einen öffentlich zugänglichen Endpunkt bereit, der Callback-Anfragen vom Auslöseranbieter empfangen kann.',
        placeholder: 'Generierung...',
        privateAddressWarning: 'Diese URL scheint eine interne Adresse zu sein, was dazu führen kann, dass Webhook-Anfragen fehlschlagen. Sie können TRIGGER_URL auf eine öffentliche Adresse ändern.',
      },
    },
    errors: {
      createFailed: 'Fehler beim Erstellen des Abonnements',
      verifyFailed: 'Anmeldeinformationen konnten nicht überprüft werden',
      authFailed: 'Autorisierung fehlgeschlagen',
      networkError: 'Netzwerkfehler, bitte versuchen Sie es erneut',
    },
  },
  events: {
    title: 'Verfügbare Veranstaltungen',
    description: 'Ereignisse, auf die dieses Trigger-Plugin reagieren kann',
    empty: 'Keine Veranstaltungen verfügbar',
    event: 'Veranstaltung',
    events: 'Veranstaltungen',
    actionNum: '{{num}} {{event}} ENTHALTEN',
    item: {
      parameters: '{{count}} Parameter',
      noParameters: 'Keine Parameter',
    },
    output: 'Ausgabe',
  },
  node: {
    status: {
      warning: 'Trennen',
    },
  },
}

export default translation
