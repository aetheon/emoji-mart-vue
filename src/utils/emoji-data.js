import { intersect, unifiedToNative } from './index'
import { uncompress, buildSearch } from './data'
import frequently from './frequently'

const SHEET_COLUMNS = 52
const COLONS_REGEX = /^(?:\:([^\:]+)\:)(?:\:skin-tone-(\d)\:)?$/
// Skin tones
const SKINS = ['1F3FA', '1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']

/**
 * Emoji data structure:
 * {
 *    "compressed": false,
 *    "aliases": {
 *      collision: "boom"
 *      cooking: "fried_egg"
 *      envelope: "email"
 *      face_with_finger_covering_closed_lips: "shushing_face"
 *      ...
 *    },
 *    "categories": [ {
 *      id: "people", 
 *      name: "Smileys & People", 
 *      emojis: [ "grinning", "grin", "joy", ... ]
 *    }, {
 *      id: "nature", 
 *      name: "Animals & Nature", 
 *      emojis: [ "monkey_face", "money", "gorilla", ... ]
 *    },
 *    ...
 *    ],
 *    "emojis": [
 *      smiley: {
 *        added_in: "6.0",
 *        emoticons: ["=)", "=-)"],
 *        has_img_apple: true,
 *        has_img_emojione: true,
 *        has_img_facebook: true,
 *        has_img_google: true,
 *        has_img_messenger: true,
 *        has_img_twitter: true,
 *        keywords: ["face", "happy", "joy", "haha", ":D", ":)", "smile", "funny"],
 *        name: "Smiling Face with Open Mouth",
 *        non_qualified: undefined,
 *        search: "smiley,smiling,face,with,open,mouth,happy,joy,haha,:d,:),smile,funny,=),=-)",
 *        sheet_x: 30,
 *        sheet_y: 27,
 *        short_names: ["smiley"],
 *        text: ":)",
 *        unified: "1F603",
 *      }, {
 *      +1: {    // emoji with skin_variations
 *          ..., // all the regular fields are present
 *          name: "Thumbs Up Sign",
 *          short_names: (2) ["+1", "thumbsup"],
 *          skin_variations: {
 *            1F3FB:             // each variation has additional set of fields:
 *              added_in: "8.0",
 *              has_img_apple: true,
 *              has_img_emojione: true,
 *              has_img_facebook: true,
 *              has_img_google: true,
 *              has_img_messenger: true,
 *              has_img_twitter: true,
 *              image: "1f44d-1f3fb.png",
 *              non_qualified: null,
 *              sheet_x: 14,
 *              sheet_y: 50,
 *              unified: "1F44D-1F3FB",
 *            1F3FB: {…},
 *            1F3FC: {…},
 *            1F3FD: {…},
 *            1F3FE: {…},
 *            1F3FF: {…}
*            },
 *          ...
 *      },
 *      a: {  // emoji with non_qualified field set
 *        added_in: "6.0",
 *        emoticons: undefined,
 *        has_img_apple: true,
 *        ...
 *        non_qualified: "1F170",
 *        unified: "1F170-FE0F",
 *     },
 *     ...
 *   ]
 * }
 */

/**
 * Wraps raw jason emoji data, serves as data source for
 * emoji picker components.
 *
 * Usage:
 *
 *   import data from '../../../data/all.json' 
 *   let index = new EmojiIndex(data)
 *
 */
export class EmojiIndex {

  /**
   * Constructor.
   *
   * @param {object} data - Raw json data, see the structure above.
   * @param {object} options - additional options, as an object:
   * @param {Function} emojisToShowFilter - optional, function to filter out
   *   some emojis, function(emoji) { return true|false }
   *   where `emoji` is an raw emoji object, see data.emojis above.
   * @param {Array} include - optional, a list of category ids to include.
   * @param {Array} exclude - optional, a list of category ids to exclude.
   * @param {Array} custom - optional, a list custom emojis, each emoji is
   *   an object, see data.emojis above for examples.
   */
  constructor(
    data, 
    {
      emojisToShowFilter,
      include,
      exclude,
      custom,
      recent,
      recentLength = 20,
    } = {}
  ) {
    this._data = uncompress(data)
    // Callback to exclude specific emojis
    this._emojisFilter = emojisToShowFilter || null
    // Categories to include / exclude
    this._include = include || null
    this._exclude = exclude || null
    // Custom emojis
    this._custom = custom || []
    // Recent emojis
    // TODO: make parameter configurable
    this._recent = recent || frequently.get(recentLength)

    this._emojis = []
    this._emoticons = []
    this._categories = []
    this._recentCategory = { id: 'recent', name: 'Recent', emojis: [] }
    this._customCategory = { id: 'custom', name: 'Custom', emojis: [] }
    this._searchIndex = {}
    this.buildIndex()
    Object.freeze(this)
  }

  buildIndex() {
    this._data.categories.forEach((categoryData) => {
      if (!this.isCategoryNeeded(categoryData)) {
        return
      }
      let category = {
        id: categoryData.id,
        name: categoryData.name,
        emojis: []
      }
      categoryData.emojis.forEach((emojiId) => {
        let emoji = this.addEmoji(emojiId)
        category.emojis.push(emoji)
      })
      this._categories.push(category)
    })

    if (this.isCategoryNeeded('custom')) {
      if (this._custom.length > 0) {
        for (let customEmoji of this._custom) {
          this.addCustomEmoji(customEmoji)
        }
      }
      this._categories.push(this._customCategory)
    }

    if (this.isCategoryNeeded('recent')) {
      if (this._recent.length) {
        this._recent.map((id) => {
          for (let customEmoji of this._customCategory.emojis) {
            if (customEmoji.id === id) {
              this._recentCategory.emojis.push(customEmoji)
              return
            }
          }
          this._recentCategory.emojis.push(this.emoji(id))
          return 
        })
      }
      // Add recent category to the top
      this._categories.unshift(this._recentCategory)
    }
  }

  /**
   * Find the emoji from the string
   */
  findEmoji(emoji, skin) {
    // 1. Parse as :emoji_name:skin-tone-xx:
    let matches = emoji.match(COLONS_REGEX)

    if (matches) {
      emoji = matches[1]
      if (matches[2]) {
        skin = parseInt(matches[2], 10)
      }
    }

    // 2. Check if the specified emoji is an alias
    if (this._data.aliases.hasOwnProperty(emoji)) {
      emoji = this._data.aliases[emoji]
    }

    // 3. Check if we have the specified emoji
    if (this._emojis.hasOwnProperty(emoji)) {
      let emojiObject = this._emojis[emoji]
      if (skin) {
        return emojiObject.getSkin(skin)
      }
      return emojiObject
    }
    return null
  }

  categories() {
    return this._categories
  }

  emoji(emojiId) {
    if (this._data.aliases.hasOwnProperty(emojiId)) {
      emojiId = this._data.aliases[emojiId]
    }
    let emoji = this._emojis[emojiId]
    if (!emoji) {
      throw new Error('Can not find emoji by id: ' + emojiId)
    }
    return emoji
  }

  search(value, maxResults) {
    maxResults || (maxResults = 75)
    if (!value.length) {
      return null
    }
    if (value == '-' || value == '-1') {
      return [this.emoji('-1')]
    }

    let values = value.toLowerCase().split(/[\s|,|\-|_]+/)
    let allResults = []

    if (values.length > 2) {
      values = [values[0], values[1]]
    }

    allResults = values.map((value) => {
      // Start searchin in the global list of emojis
      let emojis = this._emojis
      let currentIndex = this._searchIndex
      let length = 0

      for (let charIndex = 0; charIndex < value.length; charIndex++) {
        const char = value[charIndex]
        length++

        currentIndex[char] || (currentIndex[char] = {})
        currentIndex = currentIndex[char]

        if (!currentIndex.results) {
          let scores = {}
          currentIndex.results = []
          currentIndex.emojis = {}

          for (let emojiId in emojis) {
            let emoji = emojis[emojiId]
            // search is a comma-separated string with words, related
            // to the emoji, for example:
            // search: "smiley,smiling,face,joy,haha,:d,:),smile,funny,=),=-)",
            let search = emoji._data.search
            let sub = value.substr(0, length)
            let subIndex = search.indexOf(sub)
            if (subIndex != -1) {
              let score = subIndex + 1
              if (sub == emojiId) score = 0

              currentIndex.results.push(emoji)
              currentIndex.emojis[emojiId] = emoji

              scores[emojiId] = score
            }
          }
          currentIndex.results.sort((a, b) => {
            var aScore = scores[a.id],
              bScore = scores[b.id]
            return aScore - bScore
          })
        }

        // continue search in the reduced set of emojis
        emojis = currentIndex.emojis
      }
      return currentIndex.results
    // The "filter" call removes undefined values from allResults
    // array, for example, if we have "test " (with trailing space),
    // we will get "[Array, undefined]" for allResults and after
    // the "filter" call it will turn into "[Array]"
    }).filter((a) => a)

    var results = null
    if (allResults.length > 1) {
      results = intersect.apply(null, allResults)
    } else if (allResults.length) {
      results = allResults[0]
    } else {
      results = []
    }
    if (results && results.length > maxResults) {
      results = results.slice(0, maxResults)
    }
    return results
  }

  addCustomEmoji(customEmoji) {
    let emojiData = Object.assign({}, customEmoji, {
      id: customEmoji.short_names[0],
      custom: true
    })
    if (!emojiData.search) {
      emojiData.search = buildSearch(emojiData)
    }
    let emoji = new Emoji(emojiData)
    this._emojis[emoji.id] = emoji
    this._customCategory.emojis.push(emoji)
    return emoji
  }

  addEmoji(emojiId) {
    // We expect the correct emoji id that is present in the emojis data.
    let data = this._data.emojis[emojiId]

    if (!this.isEmojiNeeded(data)) {
      return false
    }

    let emoji = new Emoji(data)
    this._emojis[emojiId] = emoji

    if (emoji.emoticons) {
      emoji.emoticons.forEach((emoticon) => {
        if (this._emoticons[emoticon]) {
          return
        }
        this._emoticons[emoticon] = emojiId
      })
    }
    return emoji
  }

  /**
   * Check if we need to include given category.
   *
   * @param {object} category - The category object.
   * @return {boolean} - Whether to include the emoji.
   */
  isCategoryNeeded(category) {
    let isIncluded = this._include && this._include.length
      ? this._include.indexOf(category.id) > -1 
      : true
    let isExcluded = this._exclude && this._exclude.length
      ? this._exclude.indexOf(category.id) > -1
      : false
    if (!isIncluded || isExcluded) {
      return false
    }
    return true
  }

  /**
   * Check if we need to include given emoji.
   *
   * @param {object} emoji - The raw emoji object.
   * @return {boolean} - Whether to include the emoji.
   */
  isEmojiNeeded(emoji) {
    if (this._emojisFilter && this._emojisFilter(emoji)) {
      return false
    }
    return true
  }
}

export class Emoji {

  constructor(data) {
    this._data = Object.assign({}, data)
    this._skins = null
    if (this._data.skin_variations) {
      this._skins = []
      for (var skinIdx in SKINS) {
        let skinKey = SKINS[skinIdx]
        let variationData = this._data.skin_variations[skinKey]
        let skinData = Object.assign({}, data)
        for (let k in variationData) {
          skinData[k] = variationData[k]
        }
        delete skinData.skin_variations
        this._skins.push(new Emoji(skinData))
      }
    }
    this._sanitized = sanitize(this._data)
    for (let key in this._sanitized) {
      this[key] = this._sanitized[key]
    }
    this.short_name = this._data.short_names[0]
    Object.freeze(this)
  }

  getSkin(skinIdx) {
    if (skinIdx && skinIdx != 'native' && this._skins) {
      return this._skins[skinIdx-1]
    }
    return this
  }

  getPosition() {
      let multiply = 100 / (SHEET_COLUMNS - 1),
          x = multiply * this._data.sheet_x,
          y = multiply * this._data.sheet_y
      return `${x}% ${y}%`
  }

}


export class EmojiView {

  /**
   * emoji - Emoji to display
   * set - string, emoji set name
   * native - boolean, whether to render native emoji
   * fallback - fallback function to render missing emoji, optional
   */
  constructor(emoji, skin, set, native, fallback) {
    this._emoji = emoji
    this._native = native
    this._skin = skin
    this._set = set
    this._fallback = fallback

    this.canRender = this._canRender()
    this.cssClass = this._cssClass()
    this.cssStyle = this._cssStyle()
    this.content = this._content()

    Object.freeze(this)
  }

  _getEmoji() {
    return this._emoji.getSkin(this._skin)
  }

  _canRender() {
    return this._isCustom() || this._isNative() || this._hasEmoji() || this._fallback
  }

  _cssClass() {
    return [
      'emoji-set-' + this._set,
      'emoji-type-' + this._emojiType()
    ]
  }

  _cssStyle() {
    if (this._isCustom()) {
      return {
        backgroundImage: 'url(' + this._getEmoji()._data.imageUrl + ')',
        backgroundSize: '100%',
      }
    }
    if (this._hasEmoji() && !this._isNative()) {
      return {
        backgroundPosition: this._getEmoji().getPosition()
      }
    }
    return {}
  }

  _content() {
    if (this._isCustom()) {
      return ''
    }
    if (this._isNative()) {
      return this._getEmoji().native
    }
    if (this._hasEmoji()) {
      return ''
    }
    return this._fallback ? this._fallback(this._getEmoji()) : null
  }

  _isNative() {
    return this._native
  }

  _isCustom() {
    return this._getEmoji().custom
  }

  _hasEmoji() {
    return this._getEmoji()._data && this._getEmoji()._data['has_img_' + this._set]
  }

  _emojiType() {
    if (this._isCustom()) {
      return 'custom'
    }
    if (this._isNative()) {
      return 'native'
    }
    if (this._hasEmoji()) {
      return 'image'
    }
    return 'fallback'
  }

}

function sanitize(emoji) {
  var {
      name,
      short_names,
      skin_tone,
      skin_variations,
      emoticons,
      unified,
      custom,
      imageUrl,
    } = emoji,
    id = emoji.id || short_names[0],
    colons = `:${id}:`

  if (custom) {
    return {
      id,
      name,
      colons,
      emoticons,
      custom,
      imageUrl,
    }
  }

  if (skin_tone) {
    colons += `:skin-tone-${skin_tone}:`
  }

  return {
    id,
    name,
    colons,
    emoticons,
    unified: unified.toLowerCase(),
    skin: skin_tone || (skin_variations ? 1 : null),
    native: unifiedToNative(unified),
  }
}
