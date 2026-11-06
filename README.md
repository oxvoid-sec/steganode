# PNG Image Tools

## Commandes npm

Les commandes courantes portent des noms neutres orientes traitement d'image:

```bash
npm run optimize -- -i archive.zip -c photo1.png photo2.png -o ./processed
npm run restore -- -i ./processed/carrier-001.steg.png ./processed/carrier-002.steg.png -o restored.zip
npm run analyze -- -i ./processed/*.steg.png
```

`optimize`, `restore` et `analyze` sont respectivement des alias de `encode`, `decode` et `inspect`. Le mot de passe est demande dans le terminal; il n'est donc pas necessaire de l'inclure dans la commande. Le separateur `--` transmet les options npm au programme.

Ces noms ne changent pas le fonctionnement: `optimize` effectue l'encodage steganographique, pas une reduction du poids des images. Les noms des fichiers generes, le format public, les messages du moteur et le code source restent explicites; le renommage des commandes ne garantit pas leur discretion. Les commandes historiques `stegzip` restent disponibles.

Pour afficher l'aide: `npm run optimize -- --help`.

## Gros fichiers et progression

Les PNG sont charges et traites un par un. Le ZIP est chiffre et dechiffre par blocs,
avec un fichier temporaire pour le contenu chiffre. Il n'est jamais charge en entier
en memoire. Le format reste compatible avec les images generees par la version precedente.

La progression est affichee sur la sortie d'erreur, par etape et par image terminee.
Le pourcentage porte sur l'etape en cours, pas sur le temps total. Une grande image
peut prendre plusieurs secondes avant l'affichage du pourcentage suivant.
Ajoutez `--quiet` pour masquer la progression. La sortie JSON d'`analyze` reste exploitable.

Pour un ZIP de **85 147 Ko (87 190 528 octets)**, comptez **14 PNG de 4096 x 4096**.
Sous Windows/PowerShell, vous pouvez indiquer directement les dossiers, sans joker:

```powershell
npm run optimize -- -i "C:\donnees\archive.zip" -c "C:\photos" -o "C:\processed"
npm run restore -- -i "C:\processed" -o "C:\donnees\restored.zip"
npm run analyze -- -i "C:\processed"
```

Un dossier designe tous ses fichiers `.png`, tries par nom, sans parcourir les
sous-dossiers. Le dossier de restauration doit contenir uniquement le jeu concerne.

Pendant l'encodage, prevoyez environ la taille du ZIP en espace temporaire, en plus
des PNG de sortie. Pendant le decodage, prevoyez environ deux fois la taille du ZIP
sur le disque de destination: contenu chiffre et ZIP temporaire en cours de validation.
Ce ZIP temporaire contient du texte clair avant validation GCM; le fichier final
n'est publie qu'apres authentification. Les fichiers temporaires sont supprimes en
cas de succes ou d'erreur geree. Un arret force du processus peut en laisser sur disque.

`stegzip` cache un fichier ZIP dans les bits de poids faible des canaux RGB d'une ou plusieurs images PNG. Le ZIP est d'abord chiffre et authentifie avec **AES-256-GCM**. L'ordre des pixels de chaque image est ensuite melange de facon deterministe a partir du mot de passe, du sel aleatoire et de l'identifiant du jeu d'images.

> La steganographie masque l'existence probable des donnees, mais ne la garantit pas face a une analyse statistique. La confidentialite et l'integrite reposent sur AES-256-GCM et sur la qualite du mot de passe.

## Prerequis et installation

- Node.js 22 ou plus recent (compatibilite verifiee avec Node.js 22.21.1)
- npm

```bash
nvm use              # facultatif, si vous utilisez nvm: selectionne Node.js 22
npm install
npm link              # facultatif: installe la commande `stegzip`
```

Sans `npm link`, remplacez `stegzip` par `node bin/stegzip.js` dans les exemples.

## Encoder

```bash
stegzip encode \
  --input sauvegarde.zip \
  --carriers photo1.png photo2.png \
  --output ./images-encodees
```

Le programme demande et confirme le mot de passe. Les sorties sont nommees `carrier-001.steg.png`, `carrier-002.steg.png`, etc. Les images originales ne sont jamais modifiees.

Pour un script automatise:

```bash
STEGZIP_PASSWORD='une phrase longue et unique' stegzip encode \
  -i sauvegarde.zip -c photo1.png photo2.png -o ./images-encodees
```

## Decoder

L'ordre des images sur la ligne de commande n'a pas d'importance:

```bash
stegzip decode \
  --input images-encodees/carrier-002.steg.png images-encodees/carrier-001.steg.png \
  --output sauvegarde-restauree.zip
```

Un mauvais mot de passe, une modification du contenu ou un tag GCM invalide produit l'erreur `authentification impossible: mauvais mot de passe ou donnees corrompues`. Aucun ZIP partiel n'est publie a destination et un fichier de destination existant est preserve en cas d'echec d'authentification.

## Inspecter un jeu sans mot de passe

```bash
stegzip inspect --input images-encodees/*.steg.png
```

Cette commande affiche uniquement les metadonnees publiques: identifiant du jeu, ordre, dimensions et tailles. Elle ne revele pas le contenu.

## Capacite

Chaque pixel disponible transporte 3 bits (un dans R, G et B). Un en-tete de 104 octets reserve les 278 premiers pixels de chaque image. La capacite approximative d'une image est donc:

```text
floor((largeur * hauteur - 278) * 3 / 8) octets
```

Le chiffrement ajoute 16 octets au ZIP. Si la capacite cumulee est insuffisante, la commande s'arrete avant de creer les images.

Les PNG de sortie doivent rester **sans perte**. Les convertir en JPEG, les redimensionner, les optimiser avec un outil qui modifie les pixels ou les publier sur un service qui recompresse les images detruira probablement les donnees cachees.

## Format et securite

- Derivation de cle: `scrypt` (`N=32768`, `r=8`, `p=1`) avec sel aleatoire de 16 octets.
- Chiffrement: AES-256-GCM, nonce aleatoire de 12 octets, tag de 16 octets.
- Les metadonnees critiques publiques sont liees au ciphertext comme donnees authentifiees additionnelles (AAD).
- Chaque image a une permutation de pixels distincte, derivee par HMAC-SHA-256 de la cle, de l'identifiant du jeu et de son index.
- L'en-tete public possede un CRC32 pour signaler rapidement une corruption. Le CRC n'est pas une protection cryptographique; GCM assure l'authenticite du contenu et des metadonnees liees.
- La couche alpha n'est jamais modifiee.

L'en-tete reste necessairement visible pour retrouver le sel, le nonce, l'ordre des images et les parametres de derivation. Il ne contient ni le mot de passe, ni la cle, ni le contenu du ZIP.

## Tests

```bash
npm test
```

La suite verifie:

- l'encodage puis le decodage bit-a-bit sur deux PNG, fournis dans le desordre;
- le rejet d'un mauvais mot de passe sans creation de fichier;
- la detection d'un bit corrompu dans le contenu chiffre;
- la detection d'un en-tete corrompu.
- la compatibilite avec une image produite par la version precedente;
- le tag GCM reparti sur deux images, les fragments vides et la progression;
- la preservation du fichier de destination et le nettoyage temporaire apres echec.

Le test de grand volume est facultatif (14 PNG, plusieurs centaines de Mo de disque):

```powershell
$env:IMAGE_TOOLS_LARGE_TEST = '1'
npm test
Remove-Item Env:IMAGE_TOOLS_LARGE_TEST
```

Il cree un vrai ZIP de 85 147 Ko et compare les empreintes SHA-256 avant/apres.

Validation effectuee sur macOS avec Node.js 24.18.1: aller-retour complet sur
14 images de 4096 x 4096, empreintes SHA-256 identiques, environ 95 secondes
et 636 Mio de memoire residente maximale pour le processus de test. Les images
porteuses de ce test sont unies; ces chiffres ne sont pas une garantie pour d'autres
images ou machines. Les tests courts passent aussi sous Node.js 22.21.1.
Windows et Node.js 24.15.0 n'ont pas ete testes directement.

## Limites pratiques

- La memoire depend surtout de la taille de la plus grande image, avec un fragment chiffre a la fois. La permutation demande environ 4 octets par pixel, en plus du PNG decode (4 octets/pixel) et des buffers de compression/decompression. Pour 4096 x 4096, les pixels et la permutation seuls representent deja 128 Mio. Le pic reel depend aussi de la compression et du ramasse-miettes de Node.js; ce n'est pas une limite stricte de memoire.
- Toutes les images d'un jeu sont requises, y compris une image dont le fragment est vide.
- Le nom original du ZIP n'est pas stocke; choisissez le chemin de sortie lors du decodage.
