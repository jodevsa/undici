// @ts-check

/**
 * Combines chunks into a single Buffer
 * @param {Buffer[]} chunks
 */
function combineChunks (chunks) {
  if (chunks.length === 1) {
    return chunks[0]
  }

  return Buffer.concat(chunks)
}

module.exports = {
  combineChunks
}
