'use strict'

/**
 * Minimal JSON Schema subset validator.
 * Uses only Node.js built-ins (no external dependencies).
 *
 * Supported schema features:
 * - type (string, number, boolean, object, array, null; or array of types)
 * - required (array of required property names)
 * - properties (nested object validation)
 * - additionalProperties (schema for dynamic keys)
 * - items (array item validation)
 * - enum (allowed values)
 * - pattern (regex pattern for strings)
 * - default (informational only, not applied)
 */

/**
 * Returns the JSON-style type name for a value.
 * @param {*} value
 * @returns {string}
 */
function getType (value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Formats a type expectation for error messages.
 * @param {string|string[]} type
 * @returns {string}
 */
function formatExpected (type) {
  if (Array.isArray(type)) return type.join('|')
  return type
}

/**
 * Checks whether a value matches a type or array of types.
 * @param {*} value
 * @param {string|string[]} type
 * @returns {boolean}
 */
function matchesType (value, type) {
  const actualType = getType(value)
  if (Array.isArray(type)) {
    return type.includes(actualType)
  }
  return actualType === type
}

/**
 * Recursively validates a value against a schema node, accumulating errors.
 *
 * @param {*} value - The value to validate
 * @param {object} schema - The schema node to validate against
 * @param {string} path - Current JSON path (dot-notation)
 * @param {ValidationError[]} errors - Accumulator for errors
 */
function validateNode (value, schema, path, errors) {
  if (!schema || typeof schema !== 'object') return

  // type check
  if (schema.type !== undefined) {
    if (!matchesType(value, schema.type)) {
      errors.push({
        path,
        message: `Expected ${formatExpected(schema.type)}, got ${getType(value)}`,
        expected: formatExpected(schema.type),
        actual: value
      })
      // If type doesn't match, skip deeper validation for this node
      return
    }
  }

  // enum check
  if (schema.enum !== undefined) {
    if (!schema.enum.includes(value)) {
      errors.push({
        path,
        message: `Value must be one of: ${schema.enum.join(', ')}`,
        expected: schema.enum.join('|'),
        actual: value
      })
    }
  }

  // pattern check (strings only)
  if (schema.pattern !== undefined && typeof value === 'string') {
    const regex = new RegExp(schema.pattern)
    if (!regex.test(value)) {
      errors.push({
        path,
        message: `String does not match pattern: ${schema.pattern}`,
        expected: `pattern(${schema.pattern})`,
        actual: value
      })
    }
  }

  // object validation
  if (getType(value) === 'object') {
    // required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Missing required property: ${key}`,
            expected: 'defined',
            actual: undefined
          })
        }
      }
    }

    // properties (known keys)
    if (schema.properties) {
      for (const key of Object.keys(schema.properties)) {
        if (key in value) {
          const childPath = path ? `${path}.${key}` : key
          validateNode(value[key], schema.properties[key], childPath, errors)
        }
      }
    }

    // additionalProperties (dynamic keys not in properties)
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const knownKeys = schema.properties ? Object.keys(schema.properties) : []
      for (const key of Object.keys(value)) {
        if (!knownKeys.includes(key)) {
          const childPath = path ? `${path}.${key}` : key
          validateNode(value[key], schema.additionalProperties, childPath, errors)
        }
      }
    }
  }

  // array validation
  if (getType(value) === 'array' && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const childPath = path ? `${path}[${i}]` : `[${i}]`
      validateNode(value[i], schema.items, childPath, errors)
    }
  }
}

/**
 * Validates a config object against the schema.
 * Returns ALL errors (does not stop at first error).
 *
 * @param {object} config - Parsed config object
 * @param {object} schema - JSON Schema object (from configSchema.js)
 * @returns {{ valid: boolean, errors: ValidationError[] }}
 */
function validate (config, schema) {
  const errors = []
  validateNode(config, schema, '', errors)
  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * @typedef {object} ValidationError
 * @property {string} path - JSON path to the invalid field (e.g. "artists.golden-apes.links.spotify")
 * @property {string} message - Human-readable error description
 * @property {string} expected - What was expected
 * @property {*} actual - What was found
 */

module.exports = { validate }
