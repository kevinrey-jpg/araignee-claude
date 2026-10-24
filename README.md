# Araignée de Claude

Une araignée néon suit en direct le travail de Claude Code sur la toile de ton projet. Chaque fichier que Claude lit, modifie ou cherche, chaque commande et chaque recherche web devient un geste de l'araignée :

- **Lire** : elle soulève le cocon du fichier et son contenu remonte jusqu'à ses yeux.
- **Modifier / écrire** : elle se retourne et emballe le cocon de soie, les `+` et `−` du vrai changement s'échappent.
- **Chercher** : elle pince un fil, la vibration court jusqu'aux fichiers trouvés.
- **Commande** : elle tapote le terminal.
- **Web** : elle lâche des fils au vent.

La toile vient du graphe [Graphify](https://github.com/safishamsi/graphify) du projet (`graphify-out/graph.json`) quand il existe, sinon de l'arborescence des dossiers. Les pattes se posent sur les fils, la toile plie sous le poids de l'araignée, et son apparence se choisit parmi 13 skins.

## Installation

Dans un terminal Claude Code :

```
/plugin install araignee --marketplace kevinrey-jpg/Araignee-Claude
```

Réponds `y` pour ajouter la marketplace, puis choisis la portée « user ».

Depuis un shell :

```
claude plugin install araignee --marketplace kevinrey-jpg/Araignee-Claude
```

Dans l'application de bureau, où `/plugin` ne s'exécute pas : clique sur **+** à côté de la zone de message, puis **Plugins**, **Ajouter une marketplace** avec `kevinrey-jpg/Araignee-Claude`, puis **Ajouter le plugin**.

## Utilisation

Rien à faire : à la première action de Claude dans une discussion, l'araignée s'affiche. Dans le panneau de Claude quand l'application en propose un, sinon dans une page de ton navigateur (fichiers dans `~/.claude/araignee/`). La commande `/araignee` la rouvre à tout moment, et `/araignee-plein-ecran` ouvre la toile en grand dans le navigateur, dans sa version haute qualité (F11 pour le plein écran).

La discussion doit tourner sur ton ordinateur : dans une session Claude Code en cloud, le plugin tourne sur le serveur et la page ne peut pas s'ouvrir chez toi.
