# 🚀 TechWatch API

TechWatch est une API d'agrégation de flux RSS/Atom permettant aux utilisateurs de suivre et de surveiller en temps réel les publications de leurs sites web préférés.

## 📖 Présentation Générale

L'API permet de transformer n'importe quelle URL de site web en un flux de données structuré. Elle automatise la récupération des articles via un moteur de scraping périodique et notifie les utilisateurs instantanément via WebSockets lorsqu'un nouvel article est publié sur un flux auquel ils sont abonnés.

## ✨ Fonctionnalités Clés

### 🔐 Gestion des Utilisateurs & Sécurité Renforcée
- **Inscription et Connexion** : Système d'authentification sécurisé avec hachage de mots de passe via `bcryptjs`.
- **Système de Double Token (JWT)** : 
    - **Access Token** : Courte durée pour sécuriser les requêtes.
    - **Refresh Token** : Longue durée, stocké en base de données, permettant de renouveler la session sans reconnexion.
- **Gestion des Sessions** : Possibilité de révoquer des sessions via le logout.
- **Connexion Google & GitHub (OAuth 2.0)** : en plus de l'email et du mot de passe, un utilisateur peut se connecter avec Google ou GitHub, et lier ou dissocier ces comptes depuis son profil. L'API émet toujours ses propres JWT : le provider ne sert qu'à prouver l'identité. Voir [Connexion Google & GitHub](#-connexion-google--github).

### 📡 Gestion des Flux (Feeds)
- **Détection Intelligente** : Capacité à analyser une URL de site web pour y trouver automatiquement le flux RSS ou Atom associé.
- **Abonnements** : Système de relation permettant aux utilisateurs de s'abonner à plusieurs flux.
- **Gestion CRUD** : Ajout, mise à jour et suppression de flux.

### 📰 Agrégation d'Articles
- **Scraping Automatisé** : Un service cron tourne en arrière-plan pour mettre à jour régulièrement les flux suivis par au moins un utilisateur.
- **Requêtes conditionnelles** : le cron envoie `If-None-Match` / `If-Modified-Since` ; si le flux n'a pas changé (`304`), rien n'est téléchargé ni analysé.
- **Déduplication** : Seuls les nouveaux articles sont insérés (basé sur l'URL unique de l'article).
- **Consultation** : Récupération des articles par utilisateur (tous ses abonnements) ou par flux spécifique.

### 🗄️ Maîtrise du Volume de Données
- **Purge automatique** : le cron supprime, par lots, les articles plus vieux que `ARTICLE_RETENTION_DAYS` (60 jours par défaut) et ne garde que les `ARTICLES_MAX_PER_FEED` plus récents par flux (200 par défaut, jamais moins de 100). La purge s'exécute au plus toutes les `PURGE_INTERVAL_MS` (6 h par défaut). `0` désactive la purge par l'âge ou le plafond.
- **Pas de réinsertion** : les articles déjà plus vieux que la durée de rétention ne sont pas insérés, afin qu'ils ne soient ni purgés puis réinsérés en boucle, ni notifiés à tort.
- **Flux sans abonné** : ils ne sont plus scrapés. Leurs articles restent soumis à la purge.

### ⚡ Notifications Temps Réel
- **WebSockets** : Les utilisateurs connectés reçoivent une notification `new_articles` dès que le moteur de scraping détecte du nouveau contenu sur leurs flux.

## 🛠 Stack Technique

- **Framework** : [Hono](https://hono.dev/) (Node.js server)
- **Base de Données** : [Neon](https://neon.tech/) (PostgreSQL Serverless)
- **Authentification** : JWT (`jose`) & `bcryptjs`, OAuth 2.0 Google (PKCE) et GitHub via `fetch` + `jose`
- **Traitement RSS** : `rss-parser`
- **Temps Réel** : WebSockets (`@hono/node-ws`)
- **Documentation** : OpenAPI / Swagger UI

## 🛣️ Architecture des Endpoints

| Catégorie | Endpoint | Description |
| :--- | :--- | :--- |
| **Auth** | `POST /auth/register` | Créer un compte utilisateur |
| | `POST /auth/login` | S'authentifier $\rightarrow$ Retourne `accessToken` & `refreshToken` |
| | `POST /auth/refresh` | Renouveler l' `accessToken` via le `refreshToken` |
| | `POST /auth/logout` | Invalider le `refreshToken` et déconnecter la session |
| | `GET /auth/:provider` | Rediriger vers Google ou GitHub (`google` \| `github`) |
| | `GET /auth/:provider/callback` | Retour du provider $\rightarrow$ redirige vers le front (appelé par le provider, pas par le front) |
| | `POST /auth/oauth/exchange` | Échanger le code à usage unique contre `accessToken` & `refreshToken` |
| **Users** | `GET /users/check-username` | Vérifier la disponibilité d'un pseudo |
| | `GET /users/:id/articles` | Lister les articles d'un utilisateur |
| | `GET /users/me/oauth` | Comptes Google/GitHub liés et présence d'un mot de passe |
| | `POST /users/me/oauth/:provider/start` | Obtenir l'URL de consentement pour lier un provider |
| | `DELETE /users/me/oauth/:provider` | Dissocier un provider |
| **Feeds** | `POST /feeds/:username` | Ajouter un site et s'y abonner (Détection auto) |
| | `GET /feeds/by-username/:username` | Lister les abonnements d'un utilisateur |
| | `DELETE /feeds/:feedId/users/:username` | Se désabonner d'un flux |
| **Articles** | `POST /articles` | Tester la récupération d'articles via une liste d'URLs |
| | `GET /articles/:username/articles` | Consulter le fil d'actualité global |
| | `GET /articles/:username/feed/:feedId` | Consulter les articles d'un flux spécifique |
| **Système** | `GET /ui` | Interface Swagger UI pour tester l'API |
| **Realtime**| `WS /ws/:username` | Connexion WebSocket pour notifications |

## 🔑 Connexion Google & GitHub

### Principe

L'API implémente le flux OAuth 2.0 « Authorization Code » (avec PKCE pour Google). Une fois l'identité confirmée par le provider, l'API émet ses propres `accessToken` / `refreshToken`, identiques à ceux de `POST /auth/login`. Aucun JWT ne transite dans une URL : le front reçoit un **code à usage unique** (valable 60 secondes) qu'il échange contre la session.

Les routes `/auth/*` et `/users/me/oauth*` ne changent rien au reste de l'API : middleware JWT, WebSocket, flux et articles fonctionnent avec les comptes OAuth comme avec les autres.

### Connexion

```
Front                     API                          Google / GitHub
  │  GET /auth/google ─────▶│                                │
  │                         │── 302 + cookies state ────────▶│
  │◀────────────── page de consentement ────────────────────▶│
  │                         │◀── GET /auth/google/callback ──│
  │◀── 302 FRONTEND_URL/oauth/callback?code=XXXX ────────────│
  │  POST /auth/oauth/exchange { code } ─▶│                  │
  │◀── { accessToken, refreshToken, user }│                  │
```

1. Le front navigue vers `{API_URL}/auth/google` ou `{API_URL}/auth/github` (navigation complète, pas un `fetch`).
2. Après le consentement, l'API redirige vers **`{FRONTEND_URL}/oauth/callback?code=<code>`** en cas de succès, ou vers **`{FRONTEND_URL}/login?error=<code_erreur>`** en cas d'échec.
3. Le front appelle `POST /auth/oauth/exchange`.

#### `POST /auth/oauth/exchange`

Requête (sans en-tête d'authentification) :

```json
{ "code": "le code reçu dans l'URL" }
```

| Statut | Signification |
| :--- | :--- |
| `200` | `{ "accessToken": "...", "refreshToken": "...", "user": { "id", "username", "email", "full_name", "created_at" } }` |
| `400` | Code absent |
| `401` | Code invalide, expiré ou déjà utilisé |

#### Règles de rapprochement des comptes

Dans l'ordre, au retour du provider :

1. **Identité déjà liée** à un utilisateur $\rightarrow$ connexion.
2. **Email non vérifié** par le provider $\rightarrow$ refus (`email_not_verified`).
3. **Email déjà utilisé par un compte avec mot de passe** $\rightarrow$ refus (`email_exists`). `/auth/register` ne vérifie pas l'email : fusionner automatiquement permettrait à quelqu'un d'avoir pré-créé un compte avec l'email d'une autre personne de garder l'accès après sa connexion Google/GitHub. L'utilisateur se connecte avec son mot de passe, puis lie le provider depuis son profil.
4. **Email déjà utilisé par un compte purement OAuth** (sans mot de passe) $\rightarrow$ le nouveau provider est lié à ce compte.
5. **Sinon** $\rightarrow$ création du compte. Le `username` est généré depuis l'email (`boris`, puis `boris_483920` en cas de collision) et `full_name` depuis le nom du profil.

#### Codes d'erreur (`?error=` sur `/login`)

| Code | Cause | Message suggéré |
| :--- | :--- | :--- |
| `email_exists` | Un compte avec mot de passe existe déjà pour cet email | « Un compte existe déjà avec cet email. Connectez-vous avec votre mot de passe, puis liez Google/GitHub depuis votre profil. » |
| `email_not_verified` | Le provider n'a pas d'email vérifié | « Votre email n'est pas vérifié chez le provider. » |
| `access_denied` | L'utilisateur a refusé le consentement | « Connexion annulée. » |
| `invalid_state` | Session de connexion expirée ou invalide (cookies, délai de plus de 10 minutes) | « Session expirée, réessayez. » |
| `not_configured` | Provider non configuré côté API | « Ce mode de connexion est indisponible. » |
| `provider_error` | Erreur du provider ou réseau | « Erreur du service, réessayez plus tard. » |

### Lier et dissocier depuis le profil

Ces routes exigent un utilisateur connecté (`Authorization: Bearer <accessToken>` et `X-App-Token`).

La liaison se fait en deux temps, car une navigation du navigateur ne peut pas porter les en-têtes d'authentification : le front demande l'URL à l'API par `fetch`, puis navigue lui-même vers cette URL.

#### `GET /users/me/oauth`

```json
{
  "hasPassword": true,
  "providers": [
    { "provider": "google", "configured": true, "linked": true,  "email": "perso@gmail.com", "linkedAt": "2026-11-26T09:12:00.000Z" },
    { "provider": "github", "configured": true, "linked": false, "email": null, "linkedAt": null }
  ]
}
```

`configured: false` signifie que le provider n'est pas activé côté API : le front peut masquer le bouton.

#### `POST /users/me/oauth/:provider/start`

Retourne `{ "url": "https://accounts.google.com/..." }`. Le front fait `window.location.href = url`.

| Statut | Signification |
| :--- | :--- |
| `200` | URL de consentement |
| `400` | `code: "not_configured"` |
| `404` | Provider inconnu |
| `409` | `code: "provider_already_linked"` : un compte de ce provider est déjà lié |

Au retour, l'API redirige vers **`{FRONTEND_URL}/profile?linked=<provider>`** en cas de succès, ou **`{FRONTEND_URL}/profile?link_error=<code>`** :

| Code | Cause |
| :--- | :--- |
| `already_linked` | Ce compte Google/GitHub est déjà lié à un autre utilisateur |
| `provider_already_linked` | L'utilisateur a déjà un compte de ce provider |
| `access_denied` | Consentement refusé |
| `invalid_state` | Lien expiré (10 minutes) ou déjà utilisé : recommencer |
| `provider_error` | Erreur du provider ou réseau |

L'email du provider peut être différent de celui du compte TechWatch : l'utilisateur étant déjà authentifié, seul l'identifiant du provider compte.

#### `DELETE /users/me/oauth/:provider`

| Statut | Signification |
| :--- | :--- |
| `200` | `{ "message": "Compte dissocié avec succès" }` |
| `404` | `code: "not_linked"` : ce provider n'est pas lié |
| `409` | `code: "last_login_method"` : c'est le seul moyen de connexion du compte (ni mot de passe, ni autre provider) |

Pour dissocier le dernier provider d'un compte sans mot de passe, l'utilisateur doit d'abord en définir un via « Mot de passe oublié » (`POST /auth/forgot-password`, puis `POST /auth/reset-password`).

### Comptes sans mot de passe

Un compte créé via Google/GitHub a `password = NULL`. Impacts sur les routes existantes :

| Route | Comportement |
| :--- | :--- |
| `POST /auth/login` | `401` avec `code: "OAUTH_ONLY_ACCOUNT"` : « Ce compte utilise la connexion Google ou GitHub » |
| `PATCH /users/me/password` | `400` avec `code: "NO_PASSWORD_SET"` : utiliser « Mot de passe oublié » pour en définir un |
| `POST /auth/forgot-password` / `reset-password` | Fonctionnent normalement et permettent de définir un premier mot de passe |

### Configuration

Un provider sans ses trois variables est désactivé.

| Variable | Description |
| :--- | :--- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Identifiants du client OAuth (Google Cloud Console) |
| `GOOGLE_REDIRECT_URI` | `https://<api>/auth/google/callback` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Identifiants de l'OAuth App GitHub |
| `GITHUB_REDIRECT_URI` | `https://<api>/auth/github/callback` |
| `FRONTEND_URL` | Base des redirections vers le front (`/oauth/callback`, `/login`, `/profile`) |

- Les `*_REDIRECT_URI` pointent vers l'**API** (pas le front) et doivent être déclarées à l'identique chez Google et GitHub, une par environnement.
- Scopes demandés : `openid email profile` (Google), `read:user user:email` (GitHub).
- Les chemins du front (`/oauth/callback`, `/login`, `/profile`) sont des constantes en tête de `src/routes/oauth.route.ts`.

### Base de données

- `users.password` est nullable.
- Table `oauth_accounts` : `user_id` (supprimée en cascade avec l'utilisateur), `provider` (`google` | `github`), `provider_user_id`, `email` (celui du provider), `created_at`. Un compte Google ou GitHub ne peut être lié qu'à un seul utilisateur, et un utilisateur n'a qu'un compte par provider.
- Les migrations s'appliquent au démarrage (`runMigrations`).

### Sécurité

- **CSRF** : à la connexion, le `state` est comparé à un cookie `HttpOnly`, `SameSite=Lax` (`Secure` en production). À la liaison, le `state` est lié à l'utilisateur côté serveur : un lien piégé ne peut pas rattacher le compte d'un attaquant à une victime.
- **PKCE** pour Google, et vérification de la signature, de l'émetteur et de l'audience de l'`id_token`.
- **Email GitHub** : seul l'email principal et vérifié est retenu, jamais celui du profil public.
- **Usage unique** : codes de connexion (60 s) et `state` de liaison (10 min) sont consommés à la première utilisation.
- **Limites** : ces codes et états sont gardés en mémoire, ce qui suppose une instance unique de l'API (à déplacer en base ou dans un cache partagé en cas de plusieurs instances). Les routes `/auth/*` sont soumises à la limite de 10 requêtes par minute, et une connexion OAuth en consomme 3 (`/auth/:provider`, le callback et l'échange du code). Derrière un reverse proxy (Render, par exemple), définir `TRUSTED_PROXY=true` : sans cela, l'IP du client n'est pas lue et tous les utilisateurs partagent le même compteur.

### Exemple côté front (Vue)

```ts
// Connexion : navigation complète vers l'API
const loginWith = (provider: 'google' | 'github') =>
  (window.location.href = `${API_URL}/auth/${provider}`)

// Page /oauth/callback
const code = new URLSearchParams(location.search).get('code')
const { data } = await http.post('/auth/oauth/exchange', { code })
// stocker data.accessToken / data.refreshToken comme après un login classique

// Profil : lier un provider
const { data } = await http.post(`/users/me/oauth/${provider}/start`)
window.location.href = data.url
```

## ⚙️ Flux de Données

1. **Utilisateur** $\rightarrow$ Ajoute une URL de site.
2. **API** $\rightarrow$ Détecte le flux RSS $\rightarrow$ L'enregistre $\rightarrow$ Télécharge les premiers articles.
3. **Cron Service** $\rightarrow$ Vérifie périodiquement les flux suivis (requête conditionnelle) $\rightarrow$ Insère les nouveaux articles $\rightarrow$ Nettoie les tokens expirés $\rightarrow$ Purge les articles trop anciens ou au-delà du plafond par flux.
4. **WS Service** $\rightarrow$ Identifie les abonnés $\rightarrow$ Envoie une notification WebSocket.
