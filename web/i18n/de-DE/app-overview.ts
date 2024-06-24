const translation = {
  welcome: {
    firstStepTip: 'Um zu beginnen,',
    enterKeyTip: 'geben Sie unten Ihren OpenAI-API-Schlüssel ein',
    getKeyTip: 'Holen Sie sich Ihren API-Schlüssel vom OpenAI-Dashboard',
    placeholder: 'Ihr OpenAI-API-Schlüssel (z.B. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Sie nutzen das Testkontingent von {{providerName}}.',
        description: 'Das Testkontingent wird für Ihre Testnutzung bereitgestellt. Bevor das Testkontingent aufgebraucht ist, richten Sie bitte Ihren eigenen Modellanbieter ein oder kaufen zusätzliches Kontingent.',
      },
      exhausted: {
        title: 'Ihr Testkontingent wurde aufgebraucht, bitte richten Sie Ihren APIKey ein.',
        description: 'Ihr Testkontingent ist aufgebraucht. Bitte richten Sie Ihren eigenen Modellanbieter ein oder kaufen zusätzliches Kontingent.',
      },
    },
    selfHost: {
      title: {
        row1: 'Um zu beginnen,',
        row2: 'richten Sie zuerst Ihren Modellanbieter ein.',
      },
    },
    callTimes: 'Aufrufzeiten',
    usedToken: 'Verwendetes Token',
    setAPIBtn: 'Zum Einrichten des Modellanbieters gehen',
    tryCloud: 'Oder probieren Sie die Cloud-Version von Dify mit kostenlosem Angebot aus',
  },
  overview: {
    title: 'Übersicht',
    appInfo: {
      explanation: 'Einsatzbereite AI-WebApp',
      accessibleAddress: 'Öffentliche URL',
      preview: 'Vorschau',
      regenerate: 'Regenerieren',
      regenerateNotice: 'Möchten Sie die öffentliche URL neu generieren?',
      preUseReminder: 'Bitte aktivieren Sie WebApp, bevor Sie fortfahren.',
      settings: {
        entry: 'Einstellungen',
        title: 'WebApp-Einstellungen',
        webName: 'WebApp-Name',
        webDesc: 'WebApp-Beschreibung',
        webDescTip: 'Dieser Text wird auf der Clientseite angezeigt und bietet grundlegende Anleitungen zur Verwendung der Anwendung',
        webDescPlaceholder: 'Geben Sie die Beschreibung der WebApp ein',
        language: 'Sprache',
        workflow: {
          title: 'Workflow-Schritte',
          show: 'Anzeigen',
          hide: 'Verbergen',
        },
        more: {
          entry: 'Mehr Einstellungen anzeigen',
          copyright: 'Urheberrecht',
          copyRightPlaceholder: 'Geben Sie den Namen des Autors oder der Organisation ein',
          privacyPolicy: 'Datenschutzrichtlinie',
          privacyPolicyPlaceholder: 'Geben Sie den Link zur Datenschutzrichtlinie ein',
          privacyPolicyTip: 'Hilft Besuchern zu verstehen, welche Daten die Anwendung sammelt, siehe Difys <privacyPolicyLink>Datenschutzrichtlinie</privacyPolicyLink>.',
          customDisclaimer: 'Benutzerdefinierte Haftungsausschluss',
          customDisclaimerPlaceholder: 'Geben Sie den benutzerdefinierten Haftungsausschluss-Text ein',
          customDisclaimerTip: 'Der ben userdefinierte Haftungsausschluss-Text wird auf der Clientseite angezeigt und bietet zusätzliche Informationen über die Anwendung',
        },
      },
      embedded: {
        entry: 'Eingebettet',
        title: 'Einbetten auf der Website',
        explanation: 'Wählen Sie die Art und Weise, wie die Chat-App auf Ihrer Website eingebettet wird',
        iframe: 'Um die Chat-App an einer beliebigen Stelle auf Ihrer Website hinzuzufügen, fügen Sie diesen iframe in Ihren HTML-Code ein.',
        scripts: 'Um eine Chat-App unten rechts auf Ihrer Website hinzuzufügen, fügen Sie diesen Code in Ihren HTML-Code ein.',
        chromePlugin: 'Installieren Sie die Dify Chatbot Chrome-Erweiterung',
        copied: 'Kopiert',
        copy: 'Kopieren',
      },
      qrcode: {
        title: 'QR-Code zum Teilen',
        scan: 'Teilen Sie die Anwendung per Scan',
        download: 'QR-Code herunterladen',
      },
      customize: {
        way: 'Art',
        entry: 'Anpassen',
        title: 'AI-WebApp anpassen',
        explanation: 'Sie können das Frontend der Web-App an Ihre Szenarien und Stilbedürfnisse anpassen.',
        way1: {
          name: 'Forken Sie den Client-Code, ändern Sie ihn und deployen Sie ihn auf Vercel (empfohlen)',
          step1: 'Forken Sie den Client-Code und ändern Sie ihn',
          step1Tip: 'Klicken Sie hier, um den Quellcode in Ihr GitHub-Konto zu forken und den Code zu ändern',
          step1Operation: 'Dify-WebClient',
          step2: 'Deployen auf Vercel',
          step2Tip: 'Klicken Sie hier, um das Repository in Vercel zu importieren und zu deployen',
          step2Operation: 'Repository importieren',
          step3: 'Umgebungsvariablen konfigurieren',
          step3Tip: 'Fügen Sie die folgenden Umgebungsvariablen in Vercel hinzu',
        },
        way2: {
          name: 'Clientseitigen Code schreiben, um die API aufzurufen, und ihn auf einem Server deployen',
          operation: 'Dokumentation',
        },
      },
    },
    apiInfo: {
      title: 'Backend-Service-API',
      explanation: 'Einfach in Ihre Anwendung integrierbar',
      accessibleAddress: 'Service-API-Endpunkt',
      doc: 'API-Referenz',
    },
    status: {
      running: 'In Betrieb',
      disable: 'Deaktivieren',
    },
  },
  analysis: {
    title: 'Analyse',
    ms: 'ms',
    tokenPS: 'Token/s',
    totalMessages: {
      title: 'Gesamtnachrichten',
      explanation: 'Tägliche AI-Interaktionszählung; Prompt-Engineering/Debugging ausgenommen.',
    },
    activeUsers: {
      title: 'Aktive Benutzer',
      explanation: 'Einzigartige Benutzer, die mit AI Q&A führen; Prompt-Engineering/Debugging ausgenommen.',
    },
    tokenUsage: {
      title: 'Token-Verbrauch',
      explanation: 'Spiegelt den täglichen Token-Verbrauch des Sprachmodells für die Anwendung wider, nützlich für Kostenkontrollzwecke.',
      consumed: 'Verbraucht',
    },
    avgSessionInteractions: {
      title: 'Durchschn. Sitzungsinteraktionen',
      explanation: 'Fortlaufende Benutzer-KI-Kommunikationszählung; für konversationsbasierte Apps.',
    },
    userSatisfactionRate: {
      title: 'Benutzerzufriedenheitsrate',
      explanation: 'Die Anzahl der Likes pro 1.000 Nachrichten. Dies zeigt den Anteil der Antworten an, mit denen die Benutzer sehr zufrieden sind.',
    },
    avgResponseTime: {
      title: 'Durchschn. Antwortzeit',
      explanation: 'Zeit (ms) für die AI, um zu verarbeiten/antworten; für textbasierte Apps.',
    },
    tps: {
      title: 'Token-Ausgabegeschwindigkeit',
      explanation: 'Misst die Leistung des LLM. Zählt die Token-Ausgabegeschwindigkeit des LLM vom Beginn der Anfrage bis zum Abschluss der Ausgabe.',
    },
  },
}

export default translation
