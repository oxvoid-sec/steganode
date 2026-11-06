# Photos PNG pour le ZIP de 85 147 Ko

Le dossier `images` contient 60 paysages telecharges sur Wikimedia Commons,
recadres au centre en carre, redimensionnes a 2048 x 2048 pixels et convertis en PNG.
Les originaux du web peuvent etre des JPEG; les fichiers prepares sont de vrais PNG.
Chaque photo est distincte. Les sources, auteurs, licences et empreintes SHA-256
sont conserves dans `sources.json` et `CREDITS.txt`.

## Capacite

Chaque image transporte 1 572 759 octets. Les 60 images offrent 94 365 540 octets,
soit environ 90 Mio, pour un ZIP de 87 190 528 octets (85 147 Ko) plus 16 octets GCM.
Il faut transmettre toutes les images du jeu genere, y compris les derniers
fragments vides eventuels. Conserver l'ensemble des 60 photos au moment de l'encodage.

## Encoder depuis la racine du projet image-tools

```powershell
npm run optimize -- -i "C:\donnees\archive.zip" -c ".\outputs\png-mail\images" -o ".\processed"
```

Le mot de passe est demande dans le terminal. Les images a envoyer sont celles
du dossier `processed`, apres encodage, pas les photos d'origine du dossier `images`.

## Preparer plusieurs mails selon le poids reel des images encodees

```powershell
node .\outputs\png-mail\prepare-mails.mjs .\processed .\lots-mail
```

Le script cree des dossiers `mail-001`, `mail-002`, etc. Chaque dossier contient
au maximum 17 Mio de fichiers, credits inclus. Cette marge vise une messagerie
acceptant des messages d'environ 25 Mo, en tenant compte du surcout Base64.
La limite exacte depend de votre messagerie et de celle du destinataire.
Une limite differente peut etre indiquee en troisieme argument, en Mio:

```powershell
node .\outputs\png-mail\prepare-mails.mjs .\processed .\lots-mail-petits 12
```

Le dossier de sortie doit etre nouveau et son parent doit deja exister. Le script
copie les fichiers sans modifier les pixels et n'envoie aucun mail. Le nombre
exact de mails depend des tailles apres encodage. Les copies des lots occupent
autant de place supplementaire sur disque que les PNG encodes.

Joindre a chaque mail les fichiers du dossier correspondant, avec `CREDITS.txt`.
Indiquer que les photos ont aussi ete modifiees dans leurs pixels apres conversion.
Les licences CC BY-SA des images et de leurs adaptations restent applicables.
Le fichier de credits detaille auteur, source et lien de licence pour chaque image.

Utiliser la fonction **Joindre un fichier**, avec conservation de la taille originale.
Ne pas redimensionner, convertir en JPEG, optimiser ou recompresser les images
apres encodage. Eviter les fonctions d'envoi de photos qui modifient les pixels.

## Restaurer

Le destinataire enregistre toutes les pieces jointes PNG dans un seul dossier,
sans sous-dossiers, puis execute:

```powershell
npm run restore -- -i "C:\photos-recues" -o "C:\donnees\restored.zip"
```

## Sources et conditions

- Regles Wikimedia: https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia
- Limites Gmail (exemple, compte personnel): https://support.google.com/mail/answer/6584?hl=fr

Les 60 PNG prepares dans `images` sont volontairement versionnes dans Git, avec
leurs sources et credits. Ils representent environ 418 Mo de photos publiques.
Les archives ZIP et les PNG encodes dans `processed` restent ignores par Git.
