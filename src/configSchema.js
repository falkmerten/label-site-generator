'use strict'

/**
 * JSON Schema for content/config.json (draft-07 compatible structure).
 *
 * Defines the unified configuration format for Label Site Generator v5.
 * Used by configValidator.js for startup validation.
 *
 * Key ordering is deterministic for consistent diffs:
 * site, artists, compilations, newsletter
 */
const CONFIG_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['site', 'source', 'artists'],
  properties: {
    site: {
      type: 'object',
      required: ['name', 'mode'],
      properties: {
        name: {
          type: 'string'
        },
        url: {
          type: ['string', 'null']
        },
        mode: {
          type: 'string',
          enum: ['label', 'artist']
        },
        theme: {
          type: 'string',
          default: 'standard'
        },
        template: {
          type: ['string', 'null']
        },
        discogsUrl: {
          type: ['string', 'null']
        }
      }
    },
    source: {
      type: 'object',
      required: ['primary', 'url'],
      properties: {
        primary: {
          type: 'string',
          enum: ['bandcamp', 'archive', 'spotify']
        },
        url: {
          type: 'string'
        },
        accountType: {
          type: 'string',
          enum: ['label', 'artist']
        },
        detection: {
          type: 'string'
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low']
        }
      }
    },
    artists: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string'
          },
          enabled: {
            type: 'boolean',
            default: true
          },
          source: {
            type: 'string',
            enum: ['bandcamp', 'extra']
          },
          exclude: {
            type: 'boolean',
            default: false
          },
          excludeAlbums: {
            type: 'array',
            items: {
              type: 'string'
            }
          },
          bandcampUrl: {
            type: ['string', 'null']
          },
          links: {
            type: 'object',
            properties: {
              spotify: {
                type: ['string', 'null']
              },
              soundcharts: {
                type: ['string', 'null']
              },
              bandcamp: {
                type: ['string', 'null']
              },
              youtube: {
                type: ['string', 'null']
              },
              instagram: {
                type: ['string', 'null']
              },
              facebook: {
                type: ['string', 'null']
              },
              website: {
                type: ['string', 'null']
              },
              tiktok: {
                type: ['string', 'null']
              },
              twitter: {
                type: ['string', 'null']
              },
              bandsintown: {
                type: ['object', 'null'],
                properties: {
                  appId: {
                    type: 'string'
                  },
                  artistId: {
                    type: 'string'
                  }
                },
                required: ['appId', 'artistId']
              }
            }
          }
        }
      }
    },
    compilations: {
      type: 'array',
      items: {
        type: 'string'
      }
    },
    stores: {
      type: 'array',
      items: {
        type: ['string', 'object']
      }
    },
    newsletter: {
      type: 'object',
      properties: {
        provider: {
          type: ['string', 'null']
        },
        actionUrl: {
          type: ['string', 'null']
        },
        formId: {
          type: ['string', 'null']
        },
        listId: {
          type: ['string', 'null']
        }
      }
    }
  }
}

module.exports = { CONFIG_SCHEMA }
