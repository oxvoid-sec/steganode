#!/usr/bin/env node

// Neutral command aliases; the underlying file format and encryption are unchanged.
const aliases = { optimize: 'encode', restore: 'decode', analyze: 'inspect' };
const command = process.argv[2];
if (!command || process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`image-tools - traitement de fichiers PNG

Usage:
  npm run optimize -- -i archive.zip -c photo1.png photo2.png -o ./processed
  npm run restore -- -i ./processed/carrier-001.steg.png -o archive.zip
  npm run analyze -- -i ./processed/carrier-001.steg.png

Options:
  -i, --input       Fichier(s) source
  -c, --carriers    Images PNG de destination (optimize)
  -o, --output      Dossier ou fichier de sortie
  -p, --password    Mot de passe (saisie interactive si omis)
  -q, --quiet       Masquer la progression
  -h, --help        Afficher cette aide

Les entrees PNG acceptent aussi un dossier (sans sous-dossiers).
Fournissez toutes les images du jeu pour restore et analyze.`);
} else if (!Object.hasOwn(aliases, command)) {
  console.error(`Erreur: commande inconnue: ${command}`);
  process.exitCode = 1;
} else {
  process.argv[2] = aliases[command];
  await import('./stegzip.js');
}
