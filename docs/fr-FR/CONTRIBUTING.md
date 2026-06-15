# CONTRIBUER

Vous cherchez donc à contribuer à Dify - c'est fantastique, nous avons hâte de voir ce que vous allez faire. En tant que startup avec un personnel et un financement limités, nous avons de grandes ambitions pour concevoir le flux de travail le plus intuitif pour construire et gérer des applications LLM. Toute aide de la communauté compte, vraiment.

Nous devons être agiles et livrer rapidement compte tenu de notre position, mais nous voulons aussi nous assurer que des contributeurs comme vous obtiennent une expérience aussi fluide que possible lors de leur contribution. Nous avons élaboré ce guide de contribution dans ce but, visant à vous familiariser avec la base de code et comment nous travaillons avec les contributeurs, afin que vous puissiez rapidement passer à la partie amusante.

Ce guide, comme Dify lui-même, est un travail en constante évolution. Nous apprécions grandement votre compréhension si parfois il est en retard par rapport au projet réel, et nous accueillons tout commentaire pour nous aider à nous améliorer.

En termes de licence, veuillez prendre une minute pour lire notre bref [Accord de Licence et de Contributeur](../../LICENSE). La communauté adhère également au [code de conduite](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md).

## Avant de vous lancer

Vous cherchez quelque chose à réaliser ? Parcourez nos [problèmes pour débutants](https://github.com/langgenius/dify/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22) et choisissez-en un pour commencer !

Vous avez un nouveau modèle ou un nouvel outil à ajouter ? Ouvrez une PR dans notre [dépôt de plugins](https://github.com/langgenius/dify-plugins) et montrez-nous ce que vous avez créé.

Vous devez mettre à jour un modèle existant, un outil ou corriger des bugs ? Rendez-vous sur notre [dépôt officiel de plugins](https://github.com/langgenius/dify-official-plugins) et faites votre magie !

Rejoignez l'aventure, contribuez, et construisons ensemble quelque chose d'extraordinaire ! 💡✨

N'oubliez pas de lier un problème existant ou d'ouvrir un nouveau problème dans la description de votre PR.

### Rapports de bugs

> [!IMPORTANT]
> Veuillez vous assurer d'inclure les informations suivantes lors de la soumission d'un rapport de bug :

- Un titre clair et descriptif
- Une description détaillée du bug, y compris tous les messages d'erreur
- Les étapes pour reproduire le bug
- Comportement attendu
- **Logs**, si disponibles, pour les problèmes de backend, c'est vraiment important, vous pouvez les trouver dans les logs de docker-compose
- Captures d'écran ou vidéos, si applicable

Comment nous priorisons :

| Type de Problème                                                                                                                              | Priorité         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Bugs dans les fonctions principales (service cloud, impossibilité de se connecter, applications qui ne fonctionnent pas, failles de sécurité) | Critique         |
| Bugs non critiques, améliorations de performance                                                                                              | Priorité Moyenne |
| Corrections mineures (fautes de frappe, UI confuse mais fonctionnelle)                                                                        | Priorité Basse   |

### Demandes de fonctionnalités

> [!NOTE]
> Veuillez vous assurer d'inclure les informations suivantes lors de la soumission d'une demande de fonctionnalité :

- Un titre clair et descriptif
- Une description détaillée de la fonctionnalité
- Un cas d'utilisation pour la fonctionnalité
- Tout autre contexte ou captures d'écran concernant la demande de fonctionnalité

Comment nous priorisons :

| Type de Fonctionnalité                                                                                                                                   | Priorité              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Fonctionnalités hautement prioritaires étiquetées par un membre de l'équipe                                                                              | Priorité Haute        |
| Demandes populaires de fonctionnalités de notre [tableau de feedback communautaire](https://github.com/langgenius/dify/discussions/categories/feedbacks) | Priorité Moyenne      |
| Fonctionnalités non essentielles et améliorations mineures                                                                                               | Priorité Basse        |
| Précieuses mais non immédiates                                                                                                                           | Fonctionnalité Future |

## Soumettre votre PR

### Processus de Pull Request

1. Forkez le dépôt
1. Avant de rédiger une PR, veuillez créer un problème pour discuter des changements que vous souhaitez apporter
1. Créez une nouvelle branche pour vos changements
1. Veuillez ajouter des tests pour vos changements en conséquence
1. Assurez-vous que votre code passe les tests existants
1. Veuillez lier le problème dans la description de la PR, `fixes #<numéro_du_problème>`
1. Faites fusionner votre code !

### Configuration du projet

#### Frontend

Pour configurer le service frontend, veuillez consulter notre [guide complet](https://github.com/langgenius/dify/blob/main/web/README.md) dans le fichier `web/README.md`. Ce document fournit des instructions détaillées pour vous aider à configurer correctement l'environnement frontend.

#### Backend

Pour configurer le service backend, veuillez consulter nos [instructions détaillées](https://github.com/langgenius/dify/blob/main/api/README.md) dans le fichier `api/README.md`. Ce document contient un guide étape par étape pour vous aider à faire fonctionner le backend sans problème.

#### Autres choses à noter

Nous recommandons de revoir attentivement ce document avant de procéder à la configuration, car il contient des informations essentielles sur :

- Prérequis et dépendances
- Étapes d'installation
- Détails de configuration
- Conseils courants de dépannage

N'hésitez pas à nous contacter si vous rencontrez des problèmes pendant le processus de configuration.

## Obtenir de l'aide

Si jamais vous êtes bloqué ou avez une question urgente en contribuant, envoyez-nous simplement vos questions via le problème GitHub concerné, ou rejoignez notre [Discord](https://discord.gg/8Tpq4AcN9c) pour une discussion rapide.
