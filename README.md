# Smartphone Launch Radar

Un dashboard mensuel, sombre et responsive pour surveiller les lancements de smartphones sans transformer une rumeur en annonce officielle. Le site statique est conçu pour GitHub Pages.

## Démarrage

```bash
npm install
npm run dev
npm test
```

- `npm run validate:data` vérifie la structure et les URL de `data/events.json`.
- `npm run build` produit le site dans `dist/`.
- `npm run collect:official` interroge les sources officielles configurées et met à jour `data/research-candidates.json`.
- `npm run update:monthly` lance d’abord la collecte officielle, puis applique la promotion prudente et écrit un rapport dans `reports/`.

## Données et fiabilité

Les données sont dans [`data/events.json`](data/events.json). Les candidats bruts sont stockés séparément dans [`data/research-candidates.json`](data/research-candidates.json) et les sources autorisées dans [`data/official-sources.json`](data/official-sources.json). Chaque événement contient l’identifiant, le modèle, la marque, une date ISO, le fuseau, la région, le statut, la confiance, le résumé, les spécifications et uniquement les liens pertinents réellement disponibles.

| Valeur | Affichage | Règle |
| --- | --- | --- |
| `OFFICIAL` | Confirmé officiellement | Une URL de fabricant/événement officiel et une date ISO sont requises pour la promotion automatique. |
| `REPORTED` | À recouper | Information attribuée à une source secondaire; elle n’est jamais affichée comme confirmée. |
| `UNCONFIRMED` | Rumeur / non confirmé | Information non vérifiée; ne pas l’employer pour une date certaine. |

Les statuts sont `UPCOMING`, `LIVE`, `COMPLETED` et `TBC`. L’interface convertit automatiquement en **Terminé** un événement horodaté qui est passé. Une date TBC reste explicitement non confirmée.

### Initialisation de septembre 2026

L’initialisation ne publie aucun lancement pour septembre 2026 : aucune date officielle vérifiable n’a été trouvée dans le contexte de création. C’est intentionnel, plutôt que de publier une date spéculative. Le dashboard affiche cet état et le système est prêt à recevoir des annonces documentées.

## Collecte officielle et automatisation

[`.github/workflows/monthly-update.yml`](.github/workflows/monthly-update.yml) s’exécute chaque jour à 05:15 UTC, ou manuellement. Il :

1. interroge automatiquement les pages officielles listées dans `data/official-sources.json` ;
2. suit les liens officiels pertinents et alimente `data/research-candidates.json` sans dépendre d’une source secondaire ;
3. n’extrait une date que lorsqu’une formulation explicite de disponibilité/lancement est détectée ; une date de publication n’est jamais assimilée à une date de lancement ;
4. ne retient automatiquement pour le radar que les candidats `OFFICIAL` ayant une URL officielle et une date ISO du mois ;
5. n’écrase jamais une entrée officielle existante par une confiance inférieure ;
6. valide le JSON, génère le site et ajoute un rapport dans `reports/` ;
7. commit/pousse seulement si les données ont changé.

Le collecteur utilise uniquement des pages publiques officielles configurées dans le dépôt. Les horaires, régions et liens de streaming ne sont promus que lorsqu’ils sont publiés explicitement. Une erreur de collecte est consignée dans le fichier des candidats sans transformer une information absente en annonce. Ce mécanisme ne garantit pas une exhaustivité absolue : elle dépend des annonces publiques disponibles et de leur vérification.

## GitHub Pages

Le workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) construit et déploie après chaque push sur `main` et après une mise à jour mensuelle réussie. Dans **Settings → Pages**, sélectionnez **GitHub Actions** comme source de déploiement. Le workflow utilise l’action Pages moderne (artifact + deploy).

## Notification optionnelle

Aucune clé n’est stockée dans le dépôt. Pour obtenir une notification après une mise à jour réussie, créez le secret GitHub Actions `NOTIFICATION_WEBHOOK_URL`. Il doit contenir l’URL HTTPS d’un relais sécurisé qui accepte un POST JSON (par exemple un workflow d’e-mail, Slack ou Teams). Le workflow n’envoie rien si le secret est absent. Gardez les identifiants SMTP/API uniquement dans les secrets de ce relais — jamais dans le code.

## Architecture

- `src/main.js` : rendu, filtres, sélection, compteur temps réel et erreurs de chargement.
- `src/style.css` : interface responsive mobile/tablette/desktop et fallback visuel de produit.
- `data/events.json` : source de vérité versionnée.
- `scripts/` : validation et mise à jour mensuelle sûre.
- `.github/workflows/` : actualisation, publication Pages et notification optionnelle.
