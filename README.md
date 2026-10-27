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

### Mettre à jour

La mise à jour automatique des marketplaces GitHub est coupée par défaut. Pour avoir la dernière version, dans un terminal (PowerShell) :

```
claude plugin marketplace update araignee-claude
claude plugin update araignee@araignee-claude
```

puis redémarre Claude (ou `/reload-plugins` dans chaque discussion). Pour que ça se fasse tout seul ensuite : `/plugin` dans un terminal Claude Code, **Marketplaces**, `araignee-claude`, **Enable auto-update**.

## Utilisation

Rien à faire : à la première action de Claude dans une discussion, l'araignée s'affiche. Dans le panneau de Claude quand l'application en propose un, sinon dans une page de ton navigateur (fichiers dans `~/.claude/araignee/`). La commande `/araignee` la rouvre à tout moment, et `/araignee-plein-ecran` ouvre la toile en grand dans le navigateur, dans sa version haute qualité (F11 pour le plein écran).

### Fermer l'araignée

Le bouton **Fermer** (dans le panneau, le bandeau ou la grande toile) ou `/araignee-fermer` la ferme complètement dans cette discussion : plus de panneau, plus de bandeau, plus de grande toile, et elle ne se rouvre plus toute seule. `/araignee` la rouvre.

### En grand sur la discussion (Windows)

Le bouton **Agrandir** du panneau (ou `/araignee-grand`) ouvre la toile par-dessus toute la zone de discussion de Claude, à droite de la barre des discussions. Elle suit la fenêtre de Claude quand tu la déplaces, et disparaît quand tu passes à une autre application. **Échap** ou le bouton **Réduire** ramènent la discussion.

Si le calage n'est pas parfait, règle les marges en pixels : `/araignee-marges 300 44` (gauche, haut).

### La sphère nébuleuse

Par défaut, la toile est une sphère qui tourne, comme une carte Graphify : une boule pleine et désordonnée, calculée par une petite simulation physique (les fichiers se repoussent, les fils les rapprochent). Chaque dossier est une étoile à huit branches qui tourne lentement, chaque fichier une étoile à quatre branches qui scintille, dans un léger nuage à la couleur de sa communauté. La boule tourne doucement et se tourne vers ce que fait l'araignée ; l'araignée roule avec elle et marche sur les fils.

- **De vraies relations** : sans Graphify, l'araignée lit les imports de ton code (Python, JavaScript/TypeScript, Lua) et les liens de tes fichiers Markdown ; chaque fil relie deux fichiers qui dépendent vraiment l'un de l'autre, en plus des fils dossier → fichier.
- **Les fils** : pleins, colorés et finement tressés, ils ondulent comme des câbles posés (un, deux ou trois virages, dans tous les sens) et brillent moins que les étoiles. La même boule, aux mêmes places, dans le panneau et dans la grande toile.

- **La foudre** : à chaque action de Claude (au plus toutes les 5 secondes), et toutes les 7 à 11 secondes au repos, un éclair part de l'endroit où se trouve l'araignée et suit les fils dans tout le réseau. Chaque nébuleuse atteinte s'illumine.
- **À la souris** (grande toile) : faire glisser fait tourner la boule, avec de l'élan ; la molette zoome.
- **À plat, comme avant** : bouton **Toile** de la grande toile, et `/araignee-toile` pour le panneau.
- **L'apparence** de l'araignée est la même dans le panneau et dans la grande toile : la changer d'un côté la change de l'autre.

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

### La plongée

Quand un sous-agent ou une tâche de fond travaille sur un fichier, la grande toile plonge dedans : le cocon s'ouvre en page de soie, la caméra entre dans la page, et un bébé araignée miniature marche sur les vraies lignes.

- **Lecture** : l'araignée marche sur les mots, ligne après ligne. Sous ses pattes les lettres brillent, ce qu'elle a lu reste allumé, et quelques lettres s'envolent jusqu'à elle. Quand rien d'autre n'attend, elle prend le temps de lire ; sinon elle parcourt la page en vitesse.
- **Terminal** : les commandes lancées en arrière-plan sont confiées au bébé de la tâche de fond. Quand Claude lit leur sortie, il ouvre une page de terminal (en vert) et la parcourt de la même façon.
- **Modification** : l'araignée va à l'endroit exact du changement. Les lignes retirées se barrent et leurs lettres tombent, puis les nouvelles se tissent lettre par lettre au bout d'un fil de soie, avant un éclat vert.
- **Nouveau fichier** : la page se remplit ligne après ligne.

Le bouton **Plongée** de la grande toile choisit qui plonge : les agents seulement (par défaut), tout le monde (Claude aussi), ou personne. Dans le petit panneau, les bébés araignées ouvrent une petite page avec les mêmes lignes.

### Survoler et cliquer

Dans la grande toile, survoler un cocon montre son chemin, sa taille, son langage et la dernière fois que Claude l'a touché. Un clic ouvre le fichier avec son application habituelle (dans la page du navigateur, il copie son chemin).

### Les sons

De petits sons cristallins accompagnent les gestes : une note quand un fil est pincé, un froissement de soie, un bourdonnement pour le terminal, un arpège quand ça réussit. Ils sont coupés par défaut : bouton **Son** du panneau, `/araignee-son`, ou bouton **♪ Son** de la grande toile.

### Le bilan de fin de tour

Quand Claude a fini de répondre, l'araignée affiche un bilan : fichiers modifiés (lignes ajoutées et retirées), fichiers lus, recherches, commandes, durée, et la première phrase de la réponse de Claude.

La discussion doit tourner sur ton ordinateur : dans une session Claude Code en cloud, le plugin tourne sur le serveur et la page ne peut pas s'ouvrir chez toi.
