import { once } from 'node:events'
import { createServer } from 'node:http'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createReadStream } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const resources = fileURLToPath(join(import.meta.url, '../../runner/resources'))

// https://web-platform-tests.org/tools/wptserve/docs/stash.html
class Stash extends Map {
  take (key) {
    if (this.has(key)) {
      const value = this.get(key)

      this.delete(key)
      return value.value
    }
  }

  put (key, value, path) {
    this.set(key, { value, path })
  }
}

const stash = new Stash()

const server = createServer(async (req, res) => {
  const fullUrl = new URL(req.url, `http://localhost:${server.address().port}`)

  switch (fullUrl.pathname) {
    case '/resources/inspect-headers.py': {
      // https://github.com/web-platform-tests/wpt/blob/master/fetch/api/resources/inspect-headers.py
      const headers = []
      const checkedHeaders = fullUrl.searchParams.get('headers')?.split('|') ?? []

      if (fullUrl.searchParams.has('headers')) {
        for (let header of checkedHeaders) {
          header = header.toLowerCase()
          if (header in req.headers) {
            headers.push([`x-request-${header}`, req.headers[header] ?? ''])
          }
        }
      }

      if (fullUrl.searchParams.has('cors')) {
        if ('origin' in req.headers) {
          headers.push(['Access-Control-Allow-Origin', req.headers.origin ?? ''])
        } else {
          headers.push(['Access-Control-Allow-Origin', '*'])
        }

        headers.push(['Access-Control-Allow-Credentials', 'true'])
        headers.push(['Access-Control-Allow-Methods', 'GET, POST, HEAD'])
        const exposedHeaders = checkedHeaders.map(name => `x-request-${name}`)
        headers.push(['Access-Control-Expose-Headers', exposedHeaders.join(', ')])

        if (fullUrl.searchParams.has('allow_headers')) {
          headers.push(['Access-Control-Allow-Headers', fullUrl.searchParams.get('allow_headers')])
        } else {
          headers.push(['Access-Control-Allow-Headers', Object.keys(req.headers).join(', ')])
        }
      }

      headers.push(['content-type', 'text/plain'])

      for (const [key, value] of headers) {
        res.setHeader(key, value)
      }

      res.end('')
      break
    }
    case '/resources/data.json': {
      // https://github.com/web-platform-tests/wpt/blob/6ae3f702a332e8399fab778c831db6b7dca3f1c6/fetch/api/resources/data.json
      return createReadStream(join(resources, 'data.json'))
        .on('end', () => res.end())
        .pipe(res)
    }
    case '/resources/infinite-slow-response.py': {
      // https://github.com/web-platform-tests/wpt/blob/master/fetch/api/resources/infinite-slow-response.py
      const stateKey = fullUrl.searchParams.get('stateKey') ?? ''
      const abortKey = fullUrl.searchParams.get('abortKey') ?? ''

      if (stateKey) {
        stash.put(stateKey, 'open', fullUrl.pathname)
      }

      res.setHeader('Content-Type', 'text/plain')
      res.statusCode = 200

      res.write('.'.repeat(2048))

      while (true) {
        if (!res.write('.')) {
          break
        } else if (abortKey && stash.take(abortKey, fullUrl.pathname)) {
          break
        }

        await sleep(10)
      }

      if (stateKey) {
        stash.put(stateKey, 'closed', fullUrl.pathname)
      }

      return res.end()
    }
    case '/resources/stash-take.py': {
      // https://github.com/web-platform-tests/wpt/blob/6ae3f702a332e8399fab778c831db6b7dca3f1c6/fetch/api/resources/stash-take.py

      const key = fullUrl.searchParams.get('key')
      res.setHeader('Access-Control-Allow-Origin', '*')

      const took = stash.take(key, fullUrl.pathname) ?? null

      res.write(JSON.stringify(took))
      return res.end()
    }
    case '/resources/empty.txt': {
      return createReadStream(join(resources, 'empty.txt'))
        .on('end', () => res.end())
        .pipe(res)
    }
    default: {
      res.statusCode = 200
      res.end('body')
    }
  }
}).listen(0)

await once(server, 'listening')

const send = (message) => {
  if (typeof process.send === 'function') {
    process.send(message)
  }
}

send({ server: `http://localhost:${server.address().port}` })

process.on('message', (message) => {
  if (message === 'shutdown') {
    server.close((err) => err ? send(err) : send({ message: 'shutdown' }))
  }
})
