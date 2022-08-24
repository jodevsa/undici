'use strict'

const ParserState = {
  Beginning: 0,
  Headers: 1,
  Body: 2,
  Boundary: 3
}

const CRLF = '\r\n'

module.exports = {
  ParserState,
  CRLF
}
