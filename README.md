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

### Une toile vivante

- **La mémoire** : chaque fichier lu ou modifié épaissit et fait briller sa soie. Elle est gardée d'une discussion à l'autre et pâlit doucement au fil des jours. Les fichiers jamais touchés restent dans l'ombre : on voit d'un coup d'œil les zones chaudes du projet.
- **Les cocons** : leur taille suit le nombre de lignes du fichier, leur couleur son langage (Python, JavaScript, Markdown, JSON…), et un fichier souvent modifié s'entoure de plusieurs couches de soie.
- **La rosée** : des gouttelettes scintillent sur les fils que l'araignée vient de parcourir, puis s'évaporent en quelques minutes.
- **Les toiles des dossiers** : chaque dossier est une petite toile circulaire accrochée à la grande. En dézoomant on voit les communautés, puis les dossiers, puis les fichiers.
- **La profondeur** : des toiles lointaines et floues glissent plus lentement que la nôtre, et ce qui est loin du centre s'estompe.

### Ses réactions

- **Les émotions** : quand une commande réussit, elle fait une petite danse et passe au vert (une vraie fête quand des tests passent). Quand une commande échoue, elle se recroqueville, vire au rouge, et un fil du terminal claque.
- **Les fils qui cassent** : un fil cassé pend dans le vide et se balance, puis l'araignée revient le retisser. Quand un fichier est supprimé, ses fils claquent et son cocon tombe.
- **Le texte tissé** : quand Claude ajoute des lignes, le vrai texte file lettre par lettre le long de la soie, puis s'enroule autour du cocon.
- **Le rythme** : elle trotte quand Claude enchaîne vite, et marche posément quand il travaille lentement.
- **Le sommeil** : après trois minutes sans rien, elle remonte au centre, se suspend à un fil et se balance doucement. Au premier geste de Claude, elle se réveille et redescend.

### Les bébés araignées

Les sous-agents de Claude et les tâches en arrière-plan ont chacun leur bébé araignée. Il descend d'un fil au-dessus de l'endroit où il travaille, fait ses gestes sur la même toile, puis remonte quand son agent a fini. Une sentinelle guette le projet toutes les 2,5 secondes : quand une commande, un script ou un agent lancé en arrière-plan crée, modifie ou supprime un fichier, la toile réagit même si Claude est en train d'attendre.

### Survoler et cliquer

Dans la grande toile, survoler un cocon montre son chemin, sa taille, son langage et la dernière fois que Claude l'a touché. Un clic ouvre le fichier avec son application habituelle (dans la page du navigateur, il copie son chemin).

### Les sons

De petits sons cristallins accompagnent les gestes : une note quand un fil est pincé, un froissement de soie, un bourdonnement pour le terminal, un arpège quand ça réussit. Ils sont coupés par défaut : bouton **Son** du panneau, `/araignee-son`, ou bouton **♪ Son** de la grande toile.

### Le bilan de fin de tour

Quand Claude a fini de répondre, l'araignée affiche un bilan : fichiers modifiés (lignes ajoutées et retirées), fichiers lus, recherches, commandes, durée, et la première phrase de la réponse de Claude.

La discussion doit tourner sur ton ordinateur : dans une session Claude Code en cloud, le plugin tourne sur le serveur et la page ne peut pas s'ouvrir chez toi.
