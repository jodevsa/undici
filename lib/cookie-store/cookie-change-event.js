'use strict'

const { cookieSameSite } = require('./constants')
const { webidl } = require('../fetch/webidl')

const kChanged = Symbol('CookieChangeEvent changed')
const kDeleted = Symbol('CookieChangeEvent deleted')

// https://wicg.github.io/cookie-store/#CookieChangeEvent
class CookieChangeEvent extends Event {
  /**
   * @param {string} type
   * @param {EventInit} eventInitDict
   */
  constructor (type, eventInitDict = {}) {
    super(type, eventInitDict)

    this[kChanged] = []
    this[kDeleted] = []

    eventInitDict = webidl.converters.CookieChangeEventInit(eventInitDict)

    if (eventInitDict.changed) {
      this[kChanged].push(...eventInitDict.changed)
    }

    if (eventInitDict.deleted) {
      this[kDeleted].push(...eventInitDict.deleted)
    }

    Object.freeze(this[kChanged])
    Object.freeze(this[kDeleted])
  }

  get changed () {
    return this[kChanged]
  }

  get deleted () {
    return this[kDeleted]
  }
}

webidl.converters.CookieListItem = webidl.dictionaryConverter([
  {
    converter: webidl.converters.USVString,
    key: 'name'
  },
  {
    converter: webidl.converters.USVString,
    key: 'value'
  },
  {
    converter: webidl.nullableConverter(
      webidl.converters.USVString
    ),
    key: 'domain'
  },
  {
    converter: webidl.converters.USVString,
    key: 'path'
  },
  {
    converter: webidl.nullableConverter(
      webidl.converters['unsigned long long']
    ),
    key: 'expires'
  },
  {
    converter: webidl.converters.boolean,
    key: 'secure'
  },
  {
    converter: webidl.converters.USVString,
    key: 'sameSite',
    allowedValues: cookieSameSite
  }
])

// https://wicg.github.io/cookie-store/#typedefdef-cookielist
webidl.converters.CookieList = webidl.sequenceConverter(
  webidl.converters.CookieListItem
)

webidl.converters.CookieChangeEventInit = webidl.dictionaryConverter([
  {
    converter: webidl.converters.boolean,
    key: 'bubbles',
    defaultValue: false
  },
  {
    converter: webidl.converters.boolean,
    key: 'cancelable',
    defaultValue: false
  },
  {
    converter: webidl.converters.boolean,
    key: 'composed',
    defaultValue: false
  },
  {
    converter: webidl.converters.CookieList,
    key: 'changed'
  },
  {
    converter: webidl.converters.CookieList,
    key: 'deleted'
  }
])

module.exports = {
  CookieChangeEvent
}
