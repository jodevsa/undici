// @ts-check

'use strict'

const { parseMIMEType } = require('../fetch/dataURL')
const { webidl } = require('../fetch/webidl')
const { ParserState, CRLF } = require('./constants')
const { combineChunks } = require('./util')
const { EventEmitter } = require('events')
const assert = require('assert')

class FormDataParser extends EventEmitter {
  /** @type {Exclude<ReturnType<typeof parseMIMEType>, 'failure'>} */
  #mimeType

  #state = ParserState.Beginning

  /** @type {Buffer[]} */
  #currentChunk = []
  /** @type {Buffer[]} */
  #nextChunk = []

  /**
   * @type {Buffer}
   * @see https://www.rfc-editor.org/rfc/rfc7578#section-4.1
   */
  #boundary

  /**
   * Track the last 100 bytes.
   * @type {Buffer}
   */
  #lastBytes

  /**
   * @param {string} header The content-type header
   */
  constructor (header) {
    super()

    header = webidl.converters.ByteString(header)

    if (!header.startsWith('multipart/form-data')) {
      throw new TypeError('Expected multipart/form-data header')
    }

    const parsedMimeType = parseMIMEType(header)

    if (parsedMimeType === 'failure') {
      throw new TypeError('Failed to parse the header')
    }

    const { type, subtype, parameters } = parsedMimeType

    if (type !== 'multipart' || subtype !== 'form-data') {
      throw new TypeError(
        `Expected header essence to be multipart/form-data, got ${type}/${subtype}`
      )
    } else if (!parameters.has('boundary')) {
      throw new TypeError('Header has no boundary')
    }

    this.#mimeType = parsedMimeType
    this.#boundary = Buffer.from(`--${parsedMimeType.parameters.get('boundary')}`)
  }

  /**
   * Returns the multipart/form-data header
   * @return {`${string}/${string}; boundary=${string}`}
   */
  get contentType () {
    const { type, subtype, parameters } = this.#mimeType

    return `${type}/${subtype}; boundary=${parameters.get('boundary')}`
  }

  /**
   * Write some data to the parser.
   * It is not guaranteed to be parsed right away.
   * @param {Buffer} chunk
   */
  write (chunk) {
    // Separate the chunk received into different categories:
    //  1. The current chunk (we received a piece of a section)
    //  2. The next chunk (we received the next chunk/part of it)
    // As mentioned, it is possible to receive only *part* of
    // either chunk type. Once it has been filtered, and the
    // current chunk is finished, we can parse it rather easily.

    switch (this.#state) {
      case ParserState.Beginning:
      case ParserState.Boundary:
      case ParserState.Headers: {
        // The beginning boundary of the formdata. This is different
        // from other boundaries as it DOES NOT start with CRLF. See
        // https://www.rfc-editor.org/rfc/rfc7578#section-4.5

        // See https://www.rfc-editor.org/rfc/rfc7578#section-4.2

        // It is possible to receive multiple chunks for this single
        // value; the entire chunk; or more than the entire chunk.

        const crlf = chunk.indexOf(CRLF, this.#state === ParserState.Boundary ? 2 : 0)

        // If we received a partial header, wait for the next.
        if (crlf === -1) {
          this.#currentChunk.push(chunk)
          return
        }

        // The chunk contains CRLF OR
        // the chunk contains more than the boundary.
        const header = chunk.slice(0, crlf)
        const rest = chunk.slice(crlf + CRLF.length) // remove \r\n

        this.#currentChunk.push(header)
        if (rest.length !== 0) {
          this.#nextChunk.push(rest)
        }

        this.parse(this.#currentChunk)
        return
      }
      case ParserState.Body: {
        if (!this.#lastBytes) {
          // If the chunk doesn't have \r\n in it,
          // don't bother keeping it in memory.
          if (!chunk.includes('\r\n')) {
            this.#currentChunk.push(chunk)
          } else {
            // If it does, save it.
            this.#lastBytes = chunk
          }
        } else {
          // Otherwise combine buffers
          this.#lastBytes = Buffer.concat([this.#lastBytes, chunk])
        }

        const boundaryIndex = this.#lastBytes.indexOf(this.#boundary)

        if (Buffer.byteLength(this.#lastBytes) < 1024 && boundaryIndex === -1) {
          return
        }

        if (boundaryIndex !== -1) {
          const toBoundary = this.#lastBytes.subarray(0, boundaryIndex - CRLF.length)
          this.#currentChunk.push(toBoundary)
          this.#nextChunk.push(this.#lastBytes.subarray(toBoundary.length))
          // @ts-ignore
          this.#lastBytes = undefined

          this.parse(this.#currentChunk)
        }
      }
    }
  }

  /**
   * Parse a series of chunks.
   * Handles changing states.
   * @param {Buffer[]} chunks
   */
  parse (chunks) {
    switch (this.#state) {
      case ParserState.Boundary:
      case ParserState.Beginning: {
        const buffer = combineChunks(chunks)

        assert(buffer.indexOf(this.#boundary) !== -1)

        if (this.#state === ParserState.Beginning) {
          this.emit('boundary', buffer.slice(2))
        } else {
          this.emit('boundary', buffer.slice(4))
        }

        const next = this.#nextChunk
        this.#currentChunk = []
        this.#nextChunk = []
        // Expect headers now
        this.#state = ParserState.Headers

        for (const nextChunk of next) {
          this.write(nextChunk)
        }

        break
      }
      case ParserState.Headers: {
        const buffer = combineChunks(chunks)
        const length = buffer.length

        // "Each part MUST contain a Content-Disposition header field [RFC2183]
        //  where the disposition type is 'form-data'"
        // Once we transition from headers -> body, we will get an empty line.
        // Once we get an empty line, update state.
        // This is caused by the CRLF being cut off in #write().
        // Each part can contain [1,?] headers.

        if (length !== 0) {
          // TODO: parse header
          this.emit('header', buffer)
        } else {
          this.#state = ParserState.Body
        }

        const next = this.#nextChunk
        this.#currentChunk = []
        this.#nextChunk = []

        for (const nextChunk of next) {
          this.write(nextChunk)
        }

        break
      }
      case ParserState.Body: {
        const buffer = combineChunks(chunks)

        this.emit('body', buffer)
        this.#state = ParserState.Boundary

        const next = this.#nextChunk
        this.#currentChunk = []
        this.#nextChunk = []

        for (const nextChunk of next) {
          this.write(nextChunk)
        }

        break
      }
    }
  }
}

module.exports = {
  FormDataParser
}
