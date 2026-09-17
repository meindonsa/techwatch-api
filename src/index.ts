import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import 'dotenv/config'
import detectRoute from "./routes/detection.route.js";
import articleRoute from "./routes/article.route.js";
import articlesRoute from "./routes/articles.route.js";
import {authMiddleware} from "./middlewares/auth.middleware.js";
import {rateLimitMiddleware} from "./middlewares/rate-limit.middleware.js";
import {ssrfMiddleware} from "./middlewares/ssrf.middleware.js";
import {securityHeadersMiddleware} from "./middlewares/security-headers.middleware.js";
import {payloadSizeLimitMiddleware} from "./middlewares/size-limit.middleware.js";
import {swaggerUI} from "@hono/swagger-ui";
import {openApiDoc} from "./openapi.js";
import { cors } from "hono/cors";
import {runMigrations} from "./db/index.js";
import userRoute from "./routes/user.route.js";
import feedRoute from "./routes/feed.route.js";
import {startCron} from "./services/cron.service.js";
import {createNodeWebSocket} from "@hono/node-ws";
import {getUserById, getUserByUsername} from "./repositories/user.repository.js";
import {registerConnection, removeConnection} from "./services/ws.service.js";
import {verifyToken} from "./services/auth.service.js";
import authRoute from "./routes/auth.route.js";

async function bootstrap() {
    try {
        await runMigrations()
        console.log('🚀 DB migrations applied')
        startCron()
    } catch (e) {
        console.error('❌ Failed to bootstrap application:', e)
        process.exit(1)
    }
}

bootstrap()

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'

app.use('*', cors({
    origin: corsOrigin,
    credentials: true,
}))

app.use('*', ssrfMiddleware)
app.use('*', securityHeadersMiddleware)
app.use('*', payloadSizeLimitMiddleware)
app.use('/detect/*', authMiddleware)
app.use('/articles/*', authMiddleware)
app.use('/users/*', authMiddleware)
app.use('/feeds/*', authMiddleware)
app.use('*', rateLimitMiddleware)

app.route('/auth', authRoute)
app.route('/detect', detectRoute)
app.route('/articles', articlesRoute)
app.route('/users', userRoute)
app.route('/feeds', feedRoute)

app.get('/ws/:username', upgradeWebSocket(async (c) => {
  const username: string = c.req.param('username') || "";
  const token = c.req.query('token');

  if (!token) {
    return {
      onOpen(_, ws) {
        ws.close(1008, 'Authentication required: provide token as query parameter')
      }
    }
  }

  let authUserId: number;
  let authUsername: string;

  try {
    const payload = await verifyToken(token)
    if (payload.type !== 'access') {
      return {
        onOpen(_, ws) {
          ws.close(1008, 'Invalid token type')
        }
      }
    }
    authUserId = payload.userId
    authUsername = payload.username
  } catch {
    return {
      onOpen(_, ws) {
        ws.close(1008, 'Invalid or expired token')
      }
    }
  }

  if (authUsername !== username) {
    return {
      onOpen(_, ws) {
        ws.close(1008, 'Token username does not match URL username')
      }
    }
  }

  return {
    onOpen(_, ws) {
      if (!username || username.trim().length == 0) return;

      (async () => {
        try {
          const user = await getUserByUsername(username)
          if (!user) {
            ws.close(1008, 'User not found')
            return
          }
          registerConnection(username, ws)
          ws.send(JSON.stringify({ type: 'connected', username }))
        } catch (e) {
          console.error(`[ws] Erreur auth @${username}`, e)
          ws.close(1011, 'Internal error')
        }
      })()
    },
    onClose() {
      removeConnection(username)
    },
    onError(error) {
      console.error(`[ws] Erreur @${username}`, error)
      removeConnection(username)
    },
  }
}))

app.get('/doc', (c) => c.json(openApiDoc))
app.get('/ui', swaggerUI({ url: '/doc' }))

const server = serve({ fetch: app.fetch, port: 3000},() => {
  console.log('Server running on http://localhost:3000')
  console.log('Swagger UI → http://localhost:3000/ui')
  console.log('WebSocket  → ws://localhost:3000/ws/:userId')
})

injectWebSocket(server);
