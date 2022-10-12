// https://github.com/Ethan-Arrowood/undici-fetch

'use strict'

const { kHeadersList } = require('../core/symbols')
const { kGuard } = require('./symbols')
const { kEnumerableProperty } = require('../core/util')
const {
  makeIterator,
  isValidHeaderName,
  isValidHeaderValue
} = require('./util')
const { webidl } = require('./webidl')

/**
 * @see https://fetch.spec.whatwg.org/#concept-header-value-normalize
 * @param {string} potentialValue
 */
function headerValueNormalize (potentialValue) {
  //  To normalize a byte sequence potentialValue, remove
  //  any leading and trailing HTTP whitespace bytes from
  //  potentialValue.
  return potentialValue.replace(
    /^[\r\n\t ]+|[\r\n\t ]+$/g,
    ''
  )
}

function fill (headers, object) {
  // To fill a Headers object headers with a given object object, run these steps:

  // 1. If object is a sequence, then for each header in object:
  // Note: webidl conversion to array has already been done.
  if (Array.isArray(object)) {
    for (const header of object) {
      // 1. If header does not contain exactly two items, then throw a TypeError.
      if (header.length !== 2) {
        webidl.errors.exception({
          header: 'Headers constructor',
          message: `expected name/value pair to be length 2, found ${header.length}.`
        })
      }

      // 2. Append (header’s first item, header’s second item) to headers.
      headers.append(header[0], header[1])
    }
  } else if (typeof object === 'object' && object !== null) {
    // Note: null should throw

    // 2. Otherwise, object is a record, then for each key → value in object,
    //    append (key, value) to headers
    for (const [key, value] of Object.entries(object)) {
      headers.append(key, value)
    }
  } else {
    webidl.errors.conversionFailed({
      prefix: 'Headers constructor',
      argument: 'Argument 1',
      types: ['sequence<sequence<ByteString>>', 'record<ByteString, ByteString>']
    })
  }
}

class HeadersList {
  constructor (init) {
    if (init !== undefined) { // HeadersList
      this.backer = init.slice()
    } else {
      this.backer = []
    }
  }

  /**
   * @see https://fetch.spec.whatwg.org/#header-list-contains
   * @param {string} name
   * @param {number|undefined} startingIndex
   * @returns {number} -1 if no header exists, otherwise the index
   */
  contains (name, startingIndex = 0) {
    // A header list list contains a header name name if list
    // contains a header whose name is a byte-case-insensitive
    // match for name.
    name = name.toLowerCase()

    if (startingIndex > this.backer.length) {
      return -1
    }

    for (let i = startingIndex; i < this.backer.length; i += 2) {
      const key = this.backer[i].toLowerCase()

      if (key === name) {
        return i
      }
    }

    return -1
  }

  clear () {
    this.backer.length = 0
  }

  /**
   * @see https://fetch.spec.whatwg.org/#concept-header-list-append
   * @param {string} name
   * @param {string} value
   */
  append (name, value) {
    // 1. If list contains name, then set name to the first such header’s name.
    const idx = this.contains(name)

    if (idx !== -1) {
      name = this[idx]
    }

    // 2. Append (name, value) to list.
    this.backer.push(name, value)
  }

  /**
   * @see https://fetch.spec.whatwg.org/#concept-header-list-set
   * @param {string} name
   * @param {string} value
   */
  set (name, value) {
    // 1. If list contains name, then set the value of the first such header
    //    to value and remove the others.
    this.delete(name)

    // 2. Otherwise, append header (name, value) to list.
    this.append(name, value)
  }

  /**
   * @see https://fetch.spec.whatwg.org/#concept-header-list-delete
   * @param {string} name
   */
  delete (name) {
    // To delete a header name name from a header list list, remove all
    // headers whose name is a byte-case-insensitive match for name from list.
    let index = this.contains(name)

    while (index !== -1) {
      this.backer.splice(index, 2)
      index = this.contains(name, index)
    }
  }

  /**
   * @see https://fetch.spec.whatwg.org/#concept-header-list-get
   * @param {string} name
   * @returns {string|null} The header value, if it exists, or null
   */
  get (name) {
    let index = this.contains(name)

    // 1. If list does not contain name, then return null.
    if (index === -1) {
      return null
    }

    // 2. Return the values of all headers in list whose name is a
    //    byte-case-insensitive match for name, separated from each other by
    //    0x2C 0x20, in order.
    /** @type {string} */
    let list = ''

    while (index !== -1) {
      if (list.length === 0) {
        list += this[index + 1]
      } else {
        list += ', ' + this[index + 1]
      }
      index = this.contains(name, index + 2)
    }

    return list
  }

  has (name) {
    return this.contains(name) !== -1
  }

  /**
   * @see https://fetch.spec.whatwg.org/#concept-header-list-sort-and-combine
   */
  sortAndCombine () {
    // 1. Let headers be an empty list of headers with the key being the name
    //    and value the value.

    // 2. Let names be the result of convert header names to a sorted-lowercase
    //    set with all the names of the headers in list.

    // 3. For each name in names:
    //    1. Let value be the result of getting name from list.
    //    2. Assert: value is not null.
    //    3. Append (name, value) to headers.

    // 4. Return headers.

    const headers = {}

    for (let i = 0; i < this.backer.length; i += 2) {
      const key = this[i].toLowerCase()
      const value = this[i + 1]

      // If the index is 0, the object is empty.
      if (i !== 0 && Object.hasOwn(headers, key)) {
        headers[key] += ', ' + value
      } else {
        headers[key] = value
      }
    }

    return Object.entries(headers).sort(
      ([a], [b]) => {
        if (a > b) {
          return 1
        }

        if (a < b) {
          return -1
        }

        return 0
      }
    ).values()
  }
}

// https://fetch.spec.whatwg.org/#headers-class
class Headers {
  constructor (init = undefined) {
    this[kHeadersList] = new HeadersList()

    // The new Headers(init) constructor steps are:

    // 1. Set this’s guard to "none".
    this[kGuard] = 'none'

    // 2. If init is given, then fill this with init.
    if (init !== undefined) {
      init = webidl.converters.HeadersInit(init)
      fill(this, init)
    }
  }

  get [Symbol.toStringTag] () {
    return this.constructor.name
  }

  // https://fetch.spec.whatwg.org/#dom-headers-append
  append (name, value) {
    if (!(this instanceof Headers)) {
      throw new TypeError('Illegal invocation')
    }

    if (arguments.length < 2) {
      throw new TypeError(
        `Failed to execute 'append' on 'Headers': 2 arguments required, but only ${arguments.length} present.`
      )
    }

    name = webidl.converters.ByteString(name)
    value = webidl.converters.ByteString(value)

    // 1. Normalize value.
    value = headerValueNormalize(value)

    // 2. If name is not a header name or value is not a
    //    header value, then throw a TypeError.
    if (!isValidHeaderName(name)) {
      webidl.errors.invalidArgument({
        prefix: 'Headers.append',
        value: name,
        type: 'header name'
      })
    } else if (!isValidHeaderValue(value)) {
      webidl.errors.invalidArgument({
        prefix: 'Headers.append',
        value,
        type: 'header value'
      })
    }

    // 3. If headers’s guard is "immutable", then throw a TypeError.
    // 4. Otherwise, if headers’s guard is "request" and name is a
    //    forbidden header name, return.
    // Note: undici does not implement forbidden header names
    if (this[kGuard] === 'immutable') {
      throw new TypeError('immutable')
    } else if (this[kGuard] === 'request-no-cors') {
      // 5. Otherwise, if headers’s guard is "request-no-cors":
      // TODO
    }

    // 6. Otherwise, if headers’s guard is "response" and name is a
    //    forbidden response-header name, return.

    // 7. Append (name, value) to headers’s header list.
    // 8. If headers’s guard is "request-no-cors", then remove
    //    privileged no-CORS request headers from headers
    return this[kHeadersList].append(name, value)
  }

  // https://fetch.spec.whatwg.org/#dom-headers-delete
  delete (name) {
    if (!(this instanceof Headers)) {
      throw new TypeError('Illegal invocation')
    }

    if (arguments.length < 1) {
      throw new TypeError(
        `Failed to execute 'delete' on 'Headers': 1 argument required, but only ${arguments.length} present.`
      )
    }

    name = webidl.converters.ByteString(name)

    // 1. If name is not a header name, then throw a TypeError.
    if (!isValidHeaderName(name)) {
      webidl.errors.invalidArgument({
        prefix: 'Headers.delete',
        value: name,
        type: 'header name'
      })
    }

    // 2. If this’s guard is "immutable", then throw a TypeError.
    // 3. Otherwise, if this’s guard is "request" and name is a
    //    forbidden header name, return.
    // 4. Otherwise, if this’s guard is "request-no-cors", name
    //    is not a no-CORS-safelisted request-header name, and
    //    name is not a privileged no-CORS request-header name,
    //    return.
    // 5. Otherwise, if this’s guard is "response" and name is
    //    a forbidden response-header name, return.
    // Note: undici does not implement forbidden header names
    if (this[kGuard] === 'immutable') {
      throw new TypeError('immutable')
    } else if (this[kGuard] === 'request-no-cors') {
      // TODO
    }

    // 6. If this’s header list does not contain name, then
    //    return.
    if (!this[kHeadersList].has(name)) {
      return
    }

    // 7. Delete name from this’s header list.
    // 8. If this’s guard is "request-no-cors", then remove
    //    privileged no-CORS request headers from this.
    return this[kHeadersList].delete(name)
  }

  // https://fetch.spec.whatwg.org/#dom-headers-get
  get (name) {
    if (!(this instanceof Headers)) {
      throw new TypeError('Illegal invocation')
    }

    if (arguments.length < 1) {
      throw new TypeError(
        `Failed to execute 'get' on 'Headers': 1 argument required, but only ${arguments.length} present.`
      )
    }

    name = webidl.converters.ByteString(name)

    // 1. If name is not a header name, then throw a TypeError.
    if (!isValidHeaderName(name)) {
      webidl.errors.invalidArgument({
        prefix: 'Headers.get',
        value: name,
        type: 'header name'
      })
    }

    // 2. Return the result of getting name from this’s header
    //    list.
    return this[kHeadersList].get(name)
  }

  // https://fetch.spec.whatwg.org/#dom-headers-has
  has (name) {
    if (!(this instanceof Headers)) {
      throw new TypeError('Illegal invocation')
    }

    if (arguments.length < 1) {
      throw new TypeError(
        `Failed to execute 'has' on 'Headers': 1 argument required, but only ${arguments.length} present.`
      )
    }

    name = webidl.converters.ByteString(name)

    // 1. If name is not a header name, then throw a TypeError.
    if (!isValidHeaderName(name)) {
      webidl.errors.invalidArgument({
        prefix: 'Headers.has',
        value: name,
        type: 'header name'
      })
    }

    // 2. Return true if this’s header list contains name;
    //    otherwise false.
    return this[kHeadersList].has(name)
  }

  // https://fetch.spec.whatwg.org/#dom-headers-set
  set (name, value) {
    if (!(this instanceof Headers)) {
      throw new TypeError('Illegal invocation')
    }

    if (arguments.length < 2) {
      throw new TypeError(
        `Failed to execute 'set' on 'Headers': 2 arguments required, but only ${arguments.length} present.`
      )
    }

    name = webidl.converters.ByteString(name)
    value = webidl.converters.ByteString(value)

    // 1. Normalize value.
    value = headerValueNormalize(value)

    // 2. If name is not a header name or value is not a
    //    header value, then throw a TypeError.
    if (!isValidHeaderName(name)) {
      webidl.errors.invalidArgument({
        prefix: 'Headers.set',
        value: name,
        type: 'header name'
      })
    } else if (!isValidHeaderValue(value)) {
      webidl.errors.invalidArgument({
        prefix: 'Headers.set',
        value,
        type: 'header value'
      })
    }

    // 3. If this’s guard is "immutable", then throw a TypeError.
    // 4. Otherwise, if this’s guard is "request" and name is a
    //    forbidden header name, return.
    // 5. Otherwise, if this’s guard is "request-no-cors" and
    //    name/value is not a no-CORS-safelisted request-header,
    //    return.
    // 6. Otherwise, if this’s guard is "response" and name is a
    //    forbidden response-header name, return.
    // Note: undici does not implement forbidden header names
    if (this[kGuard] === 'immutable') {
      throw new TypeError('immutable')
    } else if (this[kGuard] === 'request-no-cors') {
      // TODO
    }

    // 7. Set (name, value) in this’s header list.
    // 8. If this’s guard is "request-no-cors", then remove
    //    privileged no-CORS request headers from this
    return this[kHeadersList].set(name, value)
  }

  keys () {
    if (!(this instanceof Headers)) {
      throw new TypeError('Illegal invocation')
    }

    const list = this[kHeadersList].sortAndCombine()

    return makeIterator(list, 'Headers', 'key')
  }

  values () {
    if (!(this instanceof Headers)) {
      throw new TypeError('Illegal invocation')
    }

    const list = this[kHeadersList].sortAndCombine()

    return makeIterator(list, 'Headers', 'value')
  }

  entries () {
    if (!(this instanceof Headers)) {
      throw new TypeError('Illegal invocation')
    }

    const list = this[kHeadersList].sortAndCombine()

    return makeIterator(list, 'Headers', 'key+value')
  }

  /**
   * @param {(value: string, key: string, self: Headers) => void} callbackFn
   * @param {unknown} thisArg
   */
  forEach (callbackFn, thisArg = globalThis) {
    if (!(this instanceof Headers)) {
      throw new TypeError('Illegal invocation')
    }

    if (arguments.length < 1) {
      throw new TypeError(
        `Failed to execute 'forEach' on 'Headers': 1 argument required, but only ${arguments.length} present.`
      )
    }

    if (typeof callbackFn !== 'function') {
      throw new TypeError(
        "Failed to execute 'forEach' on 'Headers': parameter 1 is not of type 'Function'."
      )
    }

    for (const [key, value] of this) {
      callbackFn.apply(thisArg, [value, key, this])
    }
  }

  [Symbol.for('nodejs.util.inspect.custom')] () {
    if (!(this instanceof Headers)) {
      throw new TypeError('Illegal invocation')
    }

    return this[kHeadersList]
  }
}

Headers.prototype[Symbol.iterator] = Headers.prototype.entries

Object.defineProperties(Headers.prototype, {
  append: kEnumerableProperty,
  delete: kEnumerableProperty,
  get: kEnumerableProperty,
  has: kEnumerableProperty,
  set: kEnumerableProperty,
  keys: kEnumerableProperty,
  values: kEnumerableProperty,
  entries: kEnumerableProperty,
  forEach: kEnumerableProperty,
  [Symbol.iterator]: { enumerable: false }
})

webidl.converters.HeadersInit = function (V) {
  if (webidl.util.Type(V) === 'Object') {
    if (V[Symbol.iterator]) {
      return webidl.converters['sequence<sequence<ByteString>>'](V)
    }

    return webidl.converters['record<ByteString, ByteString>'](V)
  }

  webidl.errors.conversionFailed({
    prefix: 'Headers constructor',
    argument: 'Argument 1',
    types: ['sequence<sequence<ByteString>>', 'record<ByteString, ByteString>']
  })
}

module.exports = {
  fill,
  Headers,
  HeadersList
}
