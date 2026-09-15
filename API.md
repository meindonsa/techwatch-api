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

### 📡 Gestion des Flux (Feeds)
- **Détection Intelligente** : Capacité à analyser une URL de site web pour y trouver automatiquement le flux RSS ou Atom associé.
- **Abonnements** : Système de relation permettant aux utilisateurs de s'abonner à plusieurs flux.
- **Gestion CRUD** : Ajout, mise à jour et suppression de flux.

### 📰 Agrégation d'Articles
- **Scraping Automatisé** : Un service cron tourne en arrière-plan pour mettre à jour régulièrement tous les flux enregistrés en base de données.
- **Déduplication** : Seuls les nouveaux articles sont insérés (basé sur l'URL unique de l'article).
- **Consultation** : Récupération des articles par utilisateur (tous ses abonnements) ou par flux spécifique.

### ⚡ Notifications Temps Réel
- **WebSockets** : Les utilisateurs connectés reçoivent une notification `new_articles` dès que le moteur de scraping détecte du nouveau contenu sur leurs flux.

## 🛠 Stack Technique

- **Framework** : [Hono](https://hono.dev/) (Node.js server)
- **Base de Données** : [Neon](https://neon.tech/) (PostgreSQL Serverless)
- **Authentification** : JWT (`jose`) & `bcryptjs`
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
| **Users** | `GET /users/check-username` | Vérifier la disponibilité d'un pseudo |
| | `GET /users/:id/articles` | Lister les articles d'un utilisateur |
| **Feeds** | `POST /feeds/:username` | Ajouter un site et s'y abonner (Détection auto) |
| | `GET /feeds/by-username/:username` | Lister les abonnements d'un utilisateur |
| | `DELETE /feeds/:feedId/users/:username` | Se désabonner d'un flux |
| **Articles** | `POST /articles` | Tester la récupération d'articles via une liste d'URLs |
| | `GET /articles/:username/articles` | Consulter le fil d'actualité global |
| | `GET /articles/:username/feed/:feedId` | Consulter les articles d'un flux spécifique |
| **Système** | `GET /ui` | Interface Swagger UI pour tester l'API |
| **Realtime**| `WS /ws/:username` | Connexion WebSocket pour notifications |

## ⚙️ Flux de Données

1. **Utilisateur** $\rightarrow$ Ajoute une URL de site.
2. **API** $\rightarrow$ Détecte le flux RSS $\rightarrow$ L'enregistre $\rightarrow$ Télécharge les premiers articles.
3. **Cron Service** $\rightarrow$ Vérifie périodiquement tous les flux $\rightarrow$ Insère les nouveaux articles $\rightarrow$ Nettoie les tokens expirés.
4. **WS Service** $\rightarrow$ Identifie les abonnés $\rightarrow$ Envoie une notification WebSocket.
