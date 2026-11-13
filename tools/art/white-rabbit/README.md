# Ressources du compagnon

Référence choisie par Meydeey : `../../previews/white-rabbit/assets/figurine-origin.png`.
Production via l’outil imagegen intégré, fond transparent demandé et canal alpha conservé.
Les fichiers utilisés par l’app sont dans `public/companion/`. Les prompts exacts, les références,
les dimensions et les empreintes SHA-256 sont conservés dans `provenance.json`.

7 skins : Origine, Explorateur, Matrix (`code`), Crépuscule, Égyptien, Bonbon et Horreur.
48 images disponibles sur les 49 prévues. L’édition de `code-encouragement` est refusée par le service d’image malgré plusieurs
compositions depuis les références de tenue et de pose. Elle reste explicitement indisponible dans l’atelier.
En jeu, sa demande utilise l’image d’attente du même skin. Aucun doublon ne remplace une pose
manquante dans les ressources. La diffusion du lot visuel complet attend cette image.

Chaque PNG a été ouvert et son alpha vérifié : mode RGBA, valeurs de transparence de 0 à 255.
Les variations de détails des vêtements et de la pose proviennent des images générées ; les
oreilles asymétriques, la silhouette et le visage constituent les repères communs.
Les directions 2D et pixel écartées restent uniquement dans le comparatif de développement.

Vérification de l’atelier dans un navigateur isolé, sans accès à la progression de Meydeey :

```sh
python3 tools/art/white-rabbit/check-workshop.py --url http://127.0.0.1:5176
bun test tests/appearance.test.js tests/companion.test.js tests/companion-assets.test.js
```

Les captures et résultats du contrôle d’interface vont par défaut dans
`/tmp/xchess-workshop-checks/`, hors du dépôt. Le contrôle vérifie 7 skins, 5 plateaux,
les essais verrouillés, l’équipement autorisé, sa reprise, les imports répétés et distincts,
les 3 réglages, les 3 langues et 4 formats. Il compare la taille réelle du damier d’exercice
avec le lapin affiché ou masqué. Les commentaires sont vérifiés séparément par faits résolus.

Après `bun run build`, servir `dist/` puis exécuter `check-offline.py --url http://127.0.0.1:5177`
pour vérifier le vrai cache web et les expressions, avec le réseau coupé dans le navigateur isolé.

Contrôles de campagne dans des profils jetables (aucune donnée personnelle utilisée) :

```sh
bun tools/verify-adventure.mjs
python3 tools/art/white-rabbit/check-adventure.py
python3 tools/art/white-rabbit/check-resume.py
python3 tools/art/white-rabbit/check-assistance.py
python3 tools/art/white-rabbit/check-boards.py
python3 tools/art/white-rabbit/check-accessibility.py
python3 tools/art/white-rabbit/check-adventure.py --url http://127.0.0.1:5177 --offline --output /tmp/xchess-adventure-offline
```

Le dernier contrôle exige `dist/` servi sur le port indiqué après `bun run build`. Il active
le vrai cache web, coupe le réseau du navigateur, joue les 9 rencontres au clavier contre
le moteur embarqué et équipe les récompenses après victoire, puis recharge leur sauvegarde.
Le joueur de test utilise Stockfish local via `test-player.mjs`, sans réseau.

`check-resume.py` interrompt préparation, réponse adverse, confirmation indépendante et
écriture de victoire ; il provoque une erreur transactionnelle réelle dans un journal isolé,
puis vérifie le réessai et 2 imports sans cumul. `check-assistance.py` provoque 2 échecs réels,
vérifie les reprises sans nouveaux XP et l’indice reçu, puis une victoire accompagnée.
`check-boards.py` compare les 8 parcours dans 3 formats, avec et sans compagnon, et contrôle
les réactions après résolution PGN et mat/annulation. Les données synthétiques proviennent
de `build-ui-fixture.mjs`. `check-accessibility.py` couvre FR/EN/ES, 5 tailles, clavier,
texte doublé, mouvement réduit et plafonds de commentaires. Les captures restent dans `/tmp/`.
Ces contrôles Chromium ne constituent pas une vérification native sur les appareils iOS ou Mac.
