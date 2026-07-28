import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer as createViteServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { handleApiRequest } from './index'

const PORT = Number(process.env.PORT ?? 3001)

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else if (value !== undefined) {
      headers.set(name, value)
    }
  }
  return headers
}

async function requestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return chunks.length ? Buffer.concat(chunks) : undefined
}

async function writeResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status
  response.headers.forEach((value, name) => target.setHeader(name, value))
  target.end(Buffer.from(await response.arrayBuffer()))
}

let vite: ViteDevServer

const server = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith('/api/')) {
      const origin = `http://${request.headers.host ?? `127.0.0.1:${PORT}`}`
      const webRequest = new Request(new URL(request.url, origin).toString(), {
        method: request.method,
        headers: requestHeaders(request),
        body: await requestBody(request),
      })
      const result = await handleApiRequest(webRequest)
      if (result) {
        await writeResponse(result, response)
        return
      }
    }

    vite.middlewares(request, response)
  } catch (error) {
    vite?.ssrFixStacktrace(error as Error)
    response.statusCode = 500
    response.end(error instanceof Error ? error.message : 'Unexpected error.')
  }
})

vite = await createViteServer({
  server: {
    middlewareMode: { server },
  },
  appType: 'spa',
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AnkiKani dev ready at http://127.0.0.1:${PORT}`)
})
