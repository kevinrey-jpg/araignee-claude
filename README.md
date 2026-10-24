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

### En grand sur la discussion (Windows)

Le bouton **Agrandir** du panneau (ou `/araignee-grand`) ouvre la toile par-dessus toute la zone de discussion de Claude, à droite de la barre des discussions. Elle suit la fenêtre de Claude quand tu la déplaces, et disparaît quand tu passes à une autre application. **Échap** ou le bouton **Réduire** ramènent la discussion.

Si le calage n'est pas parfait, règle les marges en pixels : `/araignee-marges 300 44` (gauche, haut).

### Les tâches en arrière-plan

L'araignée ne suit pas que Claude : les actions des sous-agents s'affichent aussi (« Agent · … »), et une sentinelle guette le projet toutes les 2,5 secondes. Quand une commande, un script ou un agent lancé en arrière-plan crée ou modifie un fichier, l'araignée va dessus (« Arrière-plan · … »), même si Claude est en train d'attendre.

### Le bilan de fin de tour

Quand Claude a fini de répondre, l'araignée affiche un bilan : fichiers modifiés (lignes ajoutées et retirées), fichiers lus, recherches, commandes, durée, et la première phrase de la réponse de Claude.

La discussion doit tourner sur ton ordinateur : dans une session Claude Code en cloud, le plugin tourne sur le serveur et la page ne peut pas s'ouvrir chez toi.
