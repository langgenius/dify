[English](./README.md) | [简体中文](./README_CN.md) | [日本語](./README_JA.md) | [Español](./README_ES.md) | [Français](./README_FR.md)

# Outils de développement local Dify.ai

## Gestion du style de code - améliorer la qualité du code

Assurez une qualité de code constante en mettant en place des crochets de pré-commission.

Une qualité de code cohérente rationalise le développement en appliquant automatiquement les normes de code. Cela minimise les déviations et simplifie la révision du code. Cela peut sembler fort, mais c'est bénéfique car cela favorise un flux de travail plus efficace et cohésif.

Il s'agit d'une mesure proactive qui permet de détecter les problèmes dès le début du cycle de développement, de gagner du temps et de maintenir la qualité du code.

### Mise en place de pre-commit

Pour installer les hooks de pre-commit, lancez :

```sh
# ATTENTION : si vous en utilisez un, assurez-vous d'être dans votre environnement virtuel

# installer le paquet pip et le hook git pour pre-commit
make install_local_dev

# Optionnel : Lien vers le script pre-commit du dépôt (ce qui permet au projet d'avoir une logique de pre-commit centralisée)
ln -s pre-commit .git/hooks/pre-commit
```

### Ce qui est vérifié

Notre configuration de pré-commission vérifie les espaces, les correcteurs EOF, et la validation de la syntaxe pour différents formats de fichiers. Elle vérifie également les problèmes de sécurité potentiels tels que les clés privées exposées.

### Hooks

Nous utilisons les hooks de `pre-commit-hooks` pour les vérifications générales, ainsi que `ruff-pre-commit` pour le linting spécifique à Python.

Référez-vous à `.pre-commit-config.yaml` pour les configurations détaillées des hooks.

## Test

Maintenez l'intégrité du code avec notre suite de tests :

### Tests d'intégration

Exécuter les tests d'intégration de l'API du modèle :

``sh
pytest api/tests/integration_tests/
```

### Tests unitaires

Évaluer la fonctionnalité de l'outil :

``sh
pytest api/tests/unit_tests/
```
