const translation = {
  category: {
    extensions: 'Erweiterungen',
    bundles: 'Bündel',
    agents: 'Agenten-Strategien',
    models: 'Modelle',
    all: 'Alle',
    tools: 'Werkzeuge',
    datasources: 'Datenquellen',
  },
  categorySingle: {
    extension: 'Erweiterung',
    agent: 'Agenten-Strategie',
    bundle: 'Bündel',
    model: 'Modell',
    tool: 'Werkzeug',
    datasource: 'Datenquelle',
  },
  list: {
    source: {
      marketplace: 'Installation aus dem Marketplace',
      github: 'Installation von GitHub',
      local: 'Installation aus lokaler Paketdatei',
    },
    notFound: 'Keine Plugins gefunden',
    noInstalled: 'Keine Plugins installiert',
  },
  source: {
    github: 'GitHub (Englisch)',
    marketplace: 'Marktplatz',
    local: 'Lokale Paketdatei',
  },
  detailPanel: {
    categoryTip: {
      local: 'Lokales Plugin',
      github: 'Installiert von Github',
      marketplace: 'Installiert aus dem Marketplace',
      debugging: 'Debuggen-Plugin',
    },
    operation: {
      remove: 'Entfernen',
      detail: 'Einzelheiten',
      install: 'Installieren',
      info: 'Plugin-Informationen',
      checkUpdate: 'Update prüfen',
      update: 'Aktualisieren',
      viewDetail: 'Im Detail sehen',
    },
    toolSelector: {
      paramsTip1: 'Steuert LLM-Inferenzparameter.',
      settings: 'BENUTZEREINSTELLUNGEN',
      uninstalledLink: 'In Plugins verwalten',
      descriptionLabel: 'Beschreibung des Werkzeugs',
      empty:
        'Klicken Sie auf die Schaltfläche "+", um Werkzeuge hinzuzufügen. Sie können mehrere Werkzeuge hinzufügen.',
      title: 'Werkzeug "Hinzufügen"',
      paramsTip2:
        'Wenn "Automatisch" ausgeschaltet ist, wird der Standardwert verwendet.',
      unsupportedContent:
        'Die installierte Plug-in-Version bietet diese Aktion nicht.',
      unsupportedTitle: 'Nicht unterstützte Aktion',
      descriptionPlaceholder:
        'Kurze Beschreibung des Zwecks des Werkzeugs, z. B. um die Temperatur für einen bestimmten Ort zu ermitteln.',
      auto: 'Auto',
      params: 'KONFIGURATION DER ARGUMENTATION',
      unsupportedContent2: 'Klicken Sie hier, um die Version zu wechseln.',
      placeholder: 'Wählen Sie ein Werkzeug aus...',
      uninstalledTitle: 'Tool nicht installiert',
      toolLabel: 'Werkzeug',
      uninstalledContent:
        'Dieses Plugin wird aus dem lokalen/GitHub-Repository installiert. Bitte nach der Installation verwenden.',
      toolSetting: 'Werkzeugs Einstellungen',
      unsupportedMCPTool:
        'Die derzeit ausgewählte Agentenstrategie-Plugin-Version unterstützt keine MCP-Tools.',
    },
    strategyNum: '{{num}} {{Strategie}} IINKLUSIVE',
    configureApp: 'App konfigurieren',
    endpointDeleteContent: 'Möchten Sie {{name}} entfernen?',
    endpointsEmpty:
      'Klicken Sie auf die Schaltfläche "+", um einen Endpunkt hinzuzufügen',
    disabled: 'Arbeitsunfähig',
    endpointsDocLink: 'Dokument anzeigen',
    endpointDisableTip: 'Endpunkt deaktivieren',
    endpoints: 'Endpunkte',
    actionNum: '{{num}} {{Aktion}} IINKLUSIVE',
    endpointModalTitle: 'Endpunkt einrichten',
    endpointModalDesc:
      'Nach der Konfiguration können die Funktionen, die das Plugin über API-Endpunkte bereitstellt, verwendet werden.',
    configureTool: 'Werkzeug konfigurieren',
    endpointsTip:
      'Dieses Plugin bietet bestimmte Funktionen über Endpunkte, und Sie können mehrere Endpunktsätze für den aktuellen Arbeitsbereich konfigurieren.',
    modelNum: '{{num}} ENTHALTENE MODELLE',
    configureModel: 'Modell konfigurieren',
    endpointDisableContent: 'Möchten Sie {{name}} deaktivieren?',
    endpointDeleteTip: 'Endpunkt entfernen',
    serviceOk: 'Service in Ordnung',
    switchVersion: 'Version wechseln',
    deprecation: {
      reason: {
        noMaintainer: 'kein Wartender',
        ownershipTransferred: 'Eigentum übertragen',
        businessAdjustments: 'Geschäftsanpassungen',
      },
      onlyReason:
        'Dieses Plugin wurde aufgrund von {{deprecatedReason}} abgelehnt und wird nicht länger aktualisiert.',
      fullMessage:
        'Dieses Plugin wurde aufgrund von {{deprecatedReason}} eingestellt und wird nicht mehr aktualisiert. Bitte verwenden Sie stattdessen <CustomLink href=\'https://example.com/\'>{{-alternativePluginId}}</CustomLink>.',
      noReason:
        'Dieses Plugin wurde eingestellt und wird nicht mehr aktualisiert.',
    },
  },
  debugInfo: {
    title: 'Debuggen',
    viewDocs: 'Dokumente anzeigen',
  },
  privilege: {
    everyone: 'Jeder',
    title: 'Plugin-Einstellungen',
    noone: 'Niemand',
    admins: 'Administratoren',
    whoCanDebug: 'Wer kann Plugins debuggen?',
    whoCanInstall: 'Wer kann Plugins installieren und verwalten?',
  },
  pluginInfoModal: {
    repository: 'Aufbewahrungsort',
    title: 'Plugin-Info',
    packageName: 'Paket',
    release: 'Loslassen',
  },
  action: {
    checkForUpdates: 'Nach Updates suchen',
    pluginInfo: 'Plugin-Info',
    usedInApps: 'Dieses Plugin wird in {{num}} Apps verwendet.',
    delete: 'Plugin entfernen',
    deleteContentRight: 'Plugin?',
    deleteContentLeft: 'Möchten Sie',
  },
  installModal: {
    labels: {
      repository: 'Aufbewahrungsort',
      package: 'Paket',
      version: 'Version',
    },
    installFailed: 'Installation fehlgeschlagen',
    installPlugin: 'Plugin installieren',
    uploadFailed: 'Upload fehlgeschlagen',
    install: 'Installieren',
    installComplete: 'Installation abgeschlossen',
    installing: 'Installation...',
    installedSuccessfullyDesc: 'Das Plugin wurde erfolgreich installiert.',
    installedSuccessfully: 'Installation erfolgreich',
    installFailedDesc: 'Die Installation des Plugins ist fehlgeschlagen.',
    pluginLoadError: 'Fehler beim Laden des Plugins',
    close: 'Schließen',
    pluginLoadErrorDesc: 'Dieses Plugin wird nicht installiert',
    cancel: 'Abbrechen',
    back: 'Zurück',
    uploadingPackage: 'Das Hochladen von {{packageName}}...',
    readyToInstallPackage: 'Über die Installation des folgenden Plugins',
    readyToInstallPackages:
      'Über die Installation der folgenden {{num}} Plugins',
    fromTrustSource:
      'Bitte stellen Sie sicher, dass Sie nur Plugins aus einer <trustSource>vertrauenswürdigen Quelle</trustSource> installieren.',
    readyToInstall: 'Über die Installation des folgenden Plugins',
    dropPluginToInstall:
      'Legen Sie das Plugin-Paket hier ab, um es zu installieren',
    next: 'Nächster',
    installWarning: 'Dieses Plugin darf nicht installiert werden.',
  },
  installFromGitHub: {
    selectPackagePlaceholder: 'Bitte wählen Sie ein Paket aus',
    gitHubRepo: 'GitHub-Repository',
    uploadFailed: 'Upload fehlgeschlagen',
    selectPackage: 'Paket auswählen',
    installFailed: 'Installation fehlgeschlagen',
    installNote:
      'Bitte stellen Sie sicher, dass Sie nur Plugins aus einer vertrauenswürdigen Quelle installieren.',
    selectVersionPlaceholder: 'Bitte wählen Sie eine Version aus',
    updatePlugin: 'Update-Plugin von GitHub',
    installPlugin: 'Plugin von GitHub installieren',
    installedSuccessfully: 'Installation erfolgreich',
    selectVersion: 'Ausführung wählen',
  },
  upgrade: {
    usedInApps: 'Wird in {{num}} Apps verwendet',
    description: 'Über die Installation des folgenden Plugins',
    upgrading: 'Installation...',
    successfulTitle: 'Installation erfolgreich',
    upgrade: 'Installieren',
    title: 'Plugin installieren',
    close: 'Schließen',
  },
  error: {
    inValidGitHubUrl:
      'Ungültige GitHub-URL. Bitte geben Sie eine gültige URL im Format ein: https://github.com/owner/repo',
    noReleasesFound:
      'Keine Veröffentlichungen gefunden. Bitte überprüfen Sie das GitHub-Repository oder die Eingabe-URL.',
    fetchReleasesError:
      'Freigaben können nicht abgerufen werden. Bitte versuchen Sie es später erneut.',
  },
  marketplace: {
    sortOption: {
      newlyReleased: 'Neu veröffentlicht',
      mostPopular: 'Beliebteste',
      firstReleased: 'Zuerst veröffentlicht',
      recentlyUpdated: 'Kürzlich aktualisiert',
    },
    viewMore: 'Mehr anzeigen',
    sortBy: 'Sortieren nach',
    discover: 'Entdecken',
    noPluginFound: 'Kein Plugin gefunden',
    difyMarketplace: 'Dify Marktplatz',
    moreFrom: 'Mehr aus dem Marketplace',
    pluginsResult: '{{num}} Ergebnisse',
    empower: 'Unterstützen Sie Ihre KI-Entwicklung',
    and: 'und',
    partnerTip: 'Von einem Dify-Partner verifiziert',
    verifiedTip: 'Von Dify überprüft',
  },
  task: {
    clearAll: 'Alle löschen',
    installingWithError:
      'Installation von {{installingLength}} Plugins, {{successLength}} erfolgreich, {{errorLength}} fehlgeschlagen',
    installingWithSuccess:
      'Installation von {{installingLength}} Plugins, {{successLength}} erfolgreich.',
    installedError: '{{errorLength}} Plugins konnten nicht installiert werden',
    installing: 'Installation von {{installingLength}} Plugins, 0 erledigt.',
    installError:
      '{{errorLength}} Plugins konnten nicht installiert werden, klicken Sie hier, um sie anzusehen',
  },
  allCategories: 'Alle Kategorien',
  install: '{{num}} Installationen',
  installAction: 'Installieren',
  from: 'Von',
  fromMarketplace: 'Aus dem Marketplace',
  search: 'Suchen',
  searchCategories: 'Kategorien durchsuchen',
  searchPlugins: 'Plugins suchen',
  endpointsEnabled: '{{num}} Gruppen von Endpunkten aktiviert',
  searchInMarketplace: 'Suche im Marketplace',
  searchTools: 'Suchwerkzeuge...',
  findMoreInMarketplace: 'Weitere Informationen finden Sie im Marketplace',
  installPlugin: 'Plugin installieren',
  installFrom: 'INSTALLIEREN VON',
  metadata: {
    title: 'Plugins',
  },
  difyVersionNotCompatible:
    'Die aktuelle Dify-Version ist mit diesem Plugin nicht kompatibel, bitte aktualisieren Sie auf die erforderliche Mindestversion: {{minimalDifyVersion}}',
  requestAPlugin: 'Ein Plugin anfordern',
  publishPlugins: 'Plugins veröffentlichen',
  auth: {
    addOAuth: 'OAuth hinzufügen',
    useOAuthAuth: 'Verwenden Sie die OAuth-Authentifizierung',
    saveAndAuth: 'Speichern und autorisieren',
    setDefault: 'Als Standard festlegen',
    oauthClientSettings: 'OAuth-Client-Einstellungen',
    saveOnly: 'Nur speichern',
    authorizations: 'Berechtigungen',
    authorization: 'Befugnis',
    workspaceDefault: 'Arbeitsbereich Standard',
    custom: 'Benutzerdefiniert',
    default: 'Standard',
    setupOAuth: 'OAuth-Client einrichten',
    addApi: 'API-Schlüssel hinzufügen',
    useOAuth: 'Verwenden Sie OAuth',
    useApi: 'Verwenden Sie den API-Schlüssel',
    oauthClient: 'OAuth-Client',
    authorizationName: 'Genehmigungsname',
    useApiAuth: 'API-Schlüssel Autorisierungs-Konfiguration',
    clientInfo:
      'Da keine System-Client-Geheimnisse für diesen Tool-Anbieter gefunden wurden, ist eine manuelle Einrichtung erforderlich. Bitte verwenden Sie für redirect_uri',
    useApiAuthDesc:
      'Nachdem die Anmeldeinformationen konfiguriert wurden, können alle Mitglieder des Arbeitsbereichs dieses Tool beim Orchestrieren von Anwendungen verwenden.',
    authRemoved: 'Die Authentifizierung wurde entfernt.',
    unavailable: 'Nicht verfügbar',
    credentialUnavailable:
      'Anmeldeinformationen derzeit nicht verfügbar. Bitte kontaktieren Sie den Administrator.',
    customCredentialUnavailable:
      'Benutzerdefinierte Anmeldeinformationen derzeit nicht verfügbar',
    credentialUnavailableInButton: 'Zugangsdaten nicht verfügbar',
    connectedWorkspace: 'Vernetzter Arbeitsbereich',
    emptyAuth: 'Bitte konfigurieren Sie die Authentifizierung',
  },
  deprecated: 'Abgelehnt',
  autoUpdate: {
    strategy: {
      disabled: {
        description: 'Plugins werden nicht automatisch aktualisiert',
        name: 'Behindert',
      },
      fixOnly: {
        name: 'Nur fixieren',
        selectedDescription: 'Auto-Update nur für Patch-Versionen',
        description:
          'Automatische Aktualisierung nur für Patchversionen (z. B. 1.0.1 → 1.0.2). Kleinere Versionsänderungen lösen keine Aktualisierungen aus.',
      },
      latest: {
        description: 'Immer auf die neueste Version aktualisieren',
        selectedDescription: 'Immer auf die neueste Version aktualisieren',
        name: 'Neueste',
      },
    },
    upgradeMode: {
      exclude: 'Ausgewählte ausschließen',
      partial: 'Nur ausgewählt',
      all: 'Alle aktualisieren',
    },
    upgradeModePlaceholder: {
      exclude: 'Ausgewählte Plugins werden nicht automatisch aktualisiert',
      partial:
        'Nur ausgewählte Plugins werden automatisch aktualisiert. Derzeit sind keine Plugins ausgewählt, daher werden keine Plugins automatisch aktualisiert.',
    },
    operation: {
      clearAll: 'Alles löschen',
      select: 'Plugins auswählen',
    },
    pluginDowngradeWarning: {
      downgrade: 'Trotzdem downgraden',
      title: 'Plugin Downgrade',
      exclude: 'Von der automatischen Aktualisierung ausschließen',
      description:
        'Die automatische Aktualisierung ist derzeit für dieses Plugin aktiviert. Ein Downgrade der Version kann dazu führen, dass Ihre Änderungen während des nächsten automatischen Updates überschrieben werden.',
    },
    noPluginPlaceholder: {
      noInstalled: 'Keine Plugins installiert',
      noFound: 'Keine Plugins gefunden.',
    },
    automaticUpdates: 'Automatische Updates',
    updateTimeTitle: 'Aktualisierungszeit',
    updateTime: 'Aktualisierungszeit',
    excludeUpdate:
      'Die folgenden {{num}} Plugins werden nicht automatisch aktualisiert.',
    changeTimezone:
      'Um die Zeitzone zu ändern, gehen Sie zu <setTimezone> Einstellungen </setTimezone>',
    nextUpdateTime: 'Nächstes automatisches Update: {{time}}',
    partialUPdate:
      'Nur die folgenden {{num}} Plugins werden automatisch aktualisiert',
    specifyPluginsToUpdate: 'Geben Sie die zu aktualisierenden Plugins an',
    updateSettings: 'Einstellungen aktualisieren',
  },
}

export default translation
