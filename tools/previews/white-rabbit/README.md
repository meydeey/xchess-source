# Comparatif du lapin blanc

Lot 0 de l’aventure, produit avant le choix artistique de Meydeey. 12 images originales produites par
`image_gen.imagegen`, 4 nouveaux plateaux dessinés en CSS et le plateau actuel. Pièces Cburnett
et moteur d’affichage Chessground identiques à ceux de l’app. Position fixe légale :
`1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5`.

Depuis la racine du dépôt :

```sh
bun run dev --host 127.0.0.1 --port 5175
```

Ouvrir <http://127.0.0.1:5175/tools/previews/white-rabbit/index.html>.
Le port dédié évite le service worker déjà installé sur le port habituel, qui traite toute
navigation comme une entrée dans l’app. Aucun service worker n’est enregistré par ce comparatif.
Les fichiers de `tools/previews/` sont exclus du build Vite de production, dont l’entrée reste
`index.html` à la racine. Aucun import depuis `src/` et aucune ressource dans `public/`.

Les sélecteurs se combinent librement. Les dimensions d’aperçu sont 390 × 844, 820 × 1180 et
1180 × 820 px. La réduction visuelle est affichée ; l’échantillon de 64 × 64 px reste à taille
réelle. Le comparateur reproduit les couleurs et dimensions du damier actuel, mesurées dans
`#/exercises/mixed` au commit `2473af2`, Chromium sombre, souris : 360 px sur téléphone et
664 px dans les 2 formats tablette. Il représente le damier, sans reproduire toute la coque de
l’app. Les thèmes changent les cases et les bordures sans réduire le damier de la scène.

Les 5 réactions sont simulées : textes, marqueurs et transformations CSS du même dessin.
Le mouvement réduit du système prime sur la case d’animation. Aucune performance aux échecs
n’est évaluée et aucune récompense n’est accordée dans cet aperçu.

« Garder cette combinaison » conserve uniquement le choix de prévisualisation dans la clé
`localStorage` `xchess-white-rabbit-preview-v1`. Le lien encode le même choix. Ni le bouton ni
le lien ne constituent une validation transmise à l’agent ; Meydeey communique ensuite son choix.
Le journal et les réglages de l’app restent indépendants. Les valeurs d’URL sont limitées aux
identifiants connus, et les messages des cadres sont filtrés par origine et fenêtre source.

Les prompts exacts et la provenance sont dans `prompts.json`, les 12 fichiers PNG dans `assets/`.
Les éditions des figurines habillées et de Crépuscule pixel ont été refusées par le service
d’images. Ces 4 recherches ont été régénérées depuis la description commune ; les différences
de visage, d’oreille, de pose et de proportions sont explicites dans la galerie. La cohérence
graphique de production suit la figurine Origine retenue. Le lot 1 a ensuite été étendu à
7 skins, soit 49 poses prévues et 48 disponibles. Les ressources utilisées et leur limite
sont décrites dans [le dossier de production](../../art/white-rabbit/README.md).

Contrôles isolés, avec l’installation Python Playwright disponible sur la machine :

```sh
python3 tools/previews/white-rabbit/check.py --output /tmp/xchess-white-rabbit-checks
bun test
bun run build
bun run docs:index:check
```

Le contrôle UI couvre les 300 combinaisons lapin/apparence/plateau/réaction, les 3 formats,
la stabilité de la position, les boutons des cadres, le clavier, le mouvement réduit, la
persistance, les erreurs de stockage/presse-papier et les URL inconnues. Ses captures et son
rapport restent dans le dossier de sortie fourni. Ce contrôle n’est pas un essai sur appareil
natif ni une validation du contenu de campagne.
