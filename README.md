# PNG Image Tools

Utilitaire Node.js pour préparer des lots d’images PNG, consulter leurs informations et restaurer le fichier source associé à un lot.

Trois commandes permettent de gérer le cycle de traitement : `optimize`, `analyze` et `restore`. Les images sont traitées une par une, avec une progression visible dans le terminal.

## Prérequis

- Node.js **22 ou version ultérieure**, notamment Node.js 24.
- npm, fourni avec Node.js.
- Des images au format PNG.

## Installation

Depuis le dossier du projet :

```powershell
npm install
```

Pour vérifier les versions disponibles :

```powershell
node --version
npm --version
```

Si vous utilisez nvm, le fichier `.nvmrc` permet de sélectionner Node.js 22 avec `nvm use`.

## Démarrage rapide

Placez vos PNG dans un dossier `photos` et votre fichier source dans `collection.zip`, puis lancez :

```powershell
npm run optimize -- -i collection.zip -c .\photos -o .\processed
```

Inspectez le lot obtenu :

```powershell
npm run analyze -- -i .\processed
```

Restaurez le fichier associé :

```powershell
npm run restore -- -i .\processed -o collection-restauree.zip
```

Les exemples utilisent la syntaxe Windows/PowerShell. Sous macOS ou Linux, utilisez des chemins comme `./photos` et `./processed`.

Le séparateur `--` transmet les options npm à la commande.

## Préparer un lot avec `optimize`

La préparation utilise un fichier source au format ZIP et une ou plusieurs images PNG de référence.

### À partir d’un dossier

```powershell
npm run optimize -- -i "C:\donnees\collection.zip" -c "C:\photos" -o "C:\processed"
```

Le programme sélectionne tous les fichiers `.png` du dossier, sans distinction de casse, et les trie par nom. Les sous-dossiers ne sont pas parcourus.

### À partir d’images sélectionnées

```powershell
npm run optimize -- -i collection.zip -c photo-01.png photo-02.png -o .\processed
```

Utilisez cette forme pour limiter le traitement à certaines images.

### Résultat

Le programme vérifie que les dimensions et le nombre d’images permettent de traiter le fichier source. Si le lot est insuffisant, il affiche une erreur avant de créer les images de sortie.

Un mot de passe est demandé et confirmé dans le terminal. Conservez-le pour la restauration du lot.

Une image de sortie est créée pour chaque PNG fourni. Utilisez un dossier de sortie distinct des images de référence et un nouveau dossier pour chaque lot afin d’éviter de mélanger les résultats.

La commande `optimize` prépare le lot ; elle ne garantit pas une réduction du poids des PNG.

## Consulter les informations avec `analyze`

```powershell
npm run analyze -- -i .\processed
```

La commande affiche les informations du lot en JSON :

- chemin du fichier et dimensions ;
- identifiant du lot ;
- position de l’image et nombre total d’images ;
- tailles associées au traitement.

L’analyse ne demande pas le mot de passe. Elle s’applique aux lots produits par l’outil.

Pour récupérer uniquement le JSON, sans les messages de lancement de npm :

```powershell
npm run --silent analyze -- -i .\processed
```

## Restaurer avec `restore`

```powershell
npm run restore -- -i "C:\processed" -o "C:\donnees\collection-restauree.zip"
```

Fournissez toutes les images du même lot et le mot de passe utilisé lors de sa préparation. L’ordre des images n’a pas d’importance : le programme retrouve leur position.

Le dossier d’entrée doit contenir uniquement les PNG du lot concerné. Toutes les images générées sont nécessaires, même si le fichier source était assez petit pour tenir dans une partie du lot.

Le fichier restauré est publié à destination après vérification de son intégrité. Un mot de passe incorrect ou un lot endommagé provoque une erreur ; dans ce cas, un fichier de destination existant est conservé.

## Options

| Option | Rôle |
| --- | --- |
| `-i`, `--input` | Fichier source pour `optimize` ; images ou dossier pour `analyze` et `restore`. |
| `-c`, `--carriers` | Images PNG de référence ou dossier d’images pour `optimize`. |
| `-o`, `--output` | Dossier de sortie pour `optimize` ; fichier ZIP de destination pour `restore`. |
| `-p`, `--password` | Mot de passe fourni directement à la commande. |
| `-q`, `--quiet` | Masquer la progression du traitement. |
| `-h`, `--help` | Afficher l’aide. |

Pour afficher l’aide :

```powershell
npm run optimize -- --help
```

La saisie interactive masque le mot de passe. Évitez de le passer avec `--password` si vous souhaitez qu’il n’apparaisse pas dans l’historique des commandes.

## Progression et ressources

Le terminal affiche la vérification des images, la préparation du fichier, le traitement des PNG et la validation lors de la restauration. Chaque pourcentage correspond à l’étape en cours, pas au temps total restant.

Pour un traitement silencieux :

```powershell
npm run optimize -- -i collection.zip -c .\photos -o .\processed --quiet
```

Les PNG sont traités un par un et le fichier source est lu par blocs. La consommation de mémoire dépend surtout des dimensions de la plus grande image et des buffers de traitement.

Prévoyez de l’espace disque pour les PNG produits et les fichiers temporaires : environ la taille du fichier source pendant la préparation, puis environ deux fois cette taille sur le disque de destination pendant la restauration. Les fichiers temporaires sont nettoyés à la fin du traitement ou après une erreur gérée. Un arrêt forcé peut en laisser sur disque.

## Conserver et partager un lot

Conservez les PNG de sortie dans leur format et leurs dimensions d’origine. Une conversion en JPEG, un redimensionnement ou une modification des pixels peut empêcher la restauration.

Pour un transfert par mail, joignez les fichiers en conservant leur taille originale. Les limites d’envoi dépendent du poids réel des PNG et de votre messagerie. Rassemblez toutes les images reçues dans un seul dossier avant d’utiliser `restore`.

## Tests

```powershell
npm test
```

La suite vérifie la préparation et la restauration des lots, les commandes npm, l’intégrité des fichiers, les erreurs de mot de passe, les lots incomplets et le nettoyage des fichiers temporaires.

Un test de grand volume est disponible séparément. Il nécessite plusieurs centaines de Mo d’espace libre :

```powershell
$env:IMAGE_TOOLS_LARGE_TEST = '1'
npm test
Remove-Item Env:IMAGE_TOOLS_LARGE_TEST
```

## Licence

MIT.
