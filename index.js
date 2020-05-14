/* eslent-env node */
/* global xelib, registerPatcher, patcherUrl, info */
// ngapp is global but unused.

const crypto = require('crypto')

function Random (edid, seed) {
  const edidbuf = Buffer.alloc(255 + 4)

  const edidLength = edid.length

  edidbuf.writeUInt32BE(seed, 0)
  edidbuf.write(edid, 4, edidLength)

  const tempbuf = edidbuf.slice(0, edidLength + 4)

  const outbuf = crypto.createHash('md5').update(tempbuf).digest()

  let state = outbuf.readUInt32BE(0)

  return function (modulus) {
    // from https://en.wikipedia.org/wiki/Xorshift
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state = state >>> 0 // state is once more uint32.
    if (modulus) return state % modulus
    return state
  }
}

function RandomElement (random) {
  return function (array) {
    return array[random(array.length - 1)]
  }
}

function getFormID (record) {
  return xelib.GetValue(record, 'Record Header\\FormID')
}

function setElementValue (record, elementName, elementValue) {
  let element = xelib.GetElement(record, elementName)
  if (!element) {
    element = xelib.AddElement(record, elementName)
  }
  xelib.SetValue(element, elementValue)
}

registerPatcher({
  info: info,
  gameModes: [xelib.gmFO4],
  settings: {
    label: 'Nanakochan-ifier',
    templateUrl: `${patcherUrl}/partials/settings.html`,
    defaultSettings: {
      onlyFemale: false,
      allFemale: false,
      patchFileName: 'zPatch.esp',
      seed: 42
    }
  },
  requiredFiles: ['AnimeRace_Nanako.esp'],
  execute: (patchFile, helpers, settings, locals) => ({
    initialize: function () {
      if (settings.seed === '') {
        locals.seed = 42
      } else {
        locals.seed = parseInt(settings.seed)
      }

      locals.baseHands = xelib.GetElement(xelib.FileByName('Fallout4.esm'), 'ARMA\\NakedHands')

      const baseFile = xelib.FileByName('AnimeRace_Nanako.esp')
      locals.baseFile = baseFile

      locals.nanaRace = getFormID(xelib.GetElement(baseFile, 'RACE\\nanaRace'))
      locals.nanaNaked = getFormID(xelib.GetElement(baseFile, 'ARMO\\nanaNaked'))
      locals.nanaHeadColor = getFormID(xelib.GetElement(baseFile, 'TXST\\nana_head_color'))

      locals.hairColors = helpers.loadRecords('CLFM').filter(
        function (color) {
          return xelib.GetFlag(color, 'FNAM', 'Remapping Index')
        }
      ).map(getFormID)

      const validRaces = new Set([
        'HeadPartsHumanGhouls [FLST:001125DF]',
        'HeadPartsHuman [FLST:000A8026]'
      ])

      const HAIR = 0b000
      const FACIAL_HAIR = 0b001
      const MALE = 0b010
      const FEMALE = 0b100

      const headPartTypeLookup = {
        Hair: HAIR,
        'Facial Hair': FACIAL_HAIR
      }

      locals.female = {
        hair: []
      }
      locals.male = {
        hair: [],
        facialHair: []
      }

      helpers.loadRecords('HDPT').forEach(function (headPart) {
        if (!validRaces.has(xelib.GetValue(headPart, 'RNAM'))) return

        const pnam = xelib.GetValue(headPart, 'PNAM')
        if (!(pnam in headPartTypeLookup)) return

        const hpt = headPartTypeLookup[pnam]

        const hpt2 = xelib.GetIntValue(headPart, 'DATA') & (MALE | FEMALE)

        const headPartFormID = getFormID(headPart)

        switch (hpt2 | hpt) {
          case MALE | HAIR:
            locals.male.hair.push(headPartFormID)
            break
          case FEMALE | HAIR:
            locals.female.hair.push(headPartFormID)
            break
          case HAIR:
          case MALE | FEMALE | HAIR:
            locals.male.hair.push(headPartFormID)
            locals.female.hair.push(headPartFormID)
            break
          case FACIAL_HAIR:
          case MALE | FACIAL_HAIR:
            locals.male.facialHair.push(headPartFormID)
            break
          case FEMALE | FACIAL_HAIR:
          case MALE | FEMALE | FACIAL_HAIR:
            break
        }
      })

      const eyesOrHairs = {}
      const eyesByModel = {}
      const eyesToModel = {}

      xelib.GetElements(baseFile, 'HDPT').forEach(
        function (headPart) {
          const pnam = xelib.GetValue(headPart, 'PNAM')
          if (pnam !== 'Hair' && pnam !== 'Eyes') return

          const headPartFormID = getFormID(headPart)

          eyesOrHairs[headPartFormID] = 1

          if (pnam === 'Eyes') {
            // TODO better way? Look at TNAM instead?
            if (!xelib.HasElement(headPart, 'Parts')) return
            const modelFile = xelib.GetValue(headPart, 'Model\\MODL')
            if (!(modelFile in eyesByModel)) {
              eyesByModel[modelFile] = []
            }
            eyesByModel[modelFile].push(headPartFormID)
            eyesToModel[headPartFormID] = modelFile
          }
        }
      )

      // Honestly, I can't see the difference, but they are different.
      locals.presets = [
        'Nana1_Preset1', // Cute
        'Nana2_Preset1', // Pretty
        'Nana3_Preset1' // Cool
      ].map(function (edid) {
        const headPartsFiltered = []

        let eyes

        xelib.GetElements(baseFile, `NPC_\\${edid}\\Head Parts`).forEach(
          function (headPart) {
            const headPartFormID = xelib.GetValue(headPart)
            const modelFile = eyesToModel[headPartFormID]
            if (modelFile) {
              eyes = eyesByModel[modelFile]
            }
            if (eyesOrHairs[headPartFormID]) return
            headPartsFiltered.push(headPartFormID)
          }
        )

        return {
          headParts: headPartsFiltered,
          eyes: eyes
        }
      })
    },
    process: [
      /*
      {
        load: {
          signature: 'RACE',
          filter: function (record) {
            if (!xelib.IsWinningOverride(record)) return false
          }
        },
        patch: function (record) {
          helpers.logMessage(`Patching ${xelib.LongName(record)}`)
        }
      },
      */
      { // patch hands to include male model
        records: function (filesToPatch) {
          return [xelib.GetElement(locals.baseFile, 'ARMA\\nanaNakedHands')]
        },
        patch: function (record) {
          helpers.logMessage(`Patching ${xelib.LongName(record)}`)

          xelib.GetElements(locals.baseHands, '').forEach(
            function (element) {
              const path = xelib.LocalPath(element)
              if (!xelib.HasElement(record, path)) {
                xelib.CopyElement(element, record)
              }
            }
          )

          // TODO perhaps it would be better to patch the base records so the Human race has Nanako's features, rather than patching all NPCs to have a different race?

          // setElementValue(record, 'Male world model\\MOD2 - Model Filename', 'Actors\\Character\\CharacterAssets\\MaleHands.nif')
          // setElementValue(record, 'Male 1st Person\\MOD4 - Model Filename', 'Actors\\Character\\CharacterAssets\\1stPersonMaleHands.nif')
        }
      },
      {
        load: {
          signature: 'NPC_',
          filter: function (record) {
            // TODO make it clearer what should and should not be included.
            if (!xelib.IsWinningOverride(record)) return false
            if (!xelib.HasElement(record, 'Head Parts')) return false
            // if (xelib.GetFlag(record, 'ACBS\\Flags', 'Is CharGen Face Preset')) return false
            if (xelib.GetValue(record, 'RNAM') !== 'HumanRace "Human" [RACE:00013746]') return false
            // if (xelib.GetValue(record, 'EDID') === 'Player') return false
            if (settings.onlyFemale && !xelib.GetIsFemale(record)) return false
            return true
          }
        },
        patch: function (record) {
          helpers.logMessage(`Patching ${xelib.LongName(record)}`)

          const stuffToRemove = [
            'MSDK',
            'MSDV',
            'Face Tinting Layers',
            'MRSV',
            'Face Morphs',
            'FMIN'
          ]

          stuffToRemove.forEach(function (thingName) {
            const foo = xelib.GetElement(record, thingName)
            if (foo) {
              xelib.RemoveElement(foo)
            }
          })

          const fixedValues = [
            ['RNAM', locals.nanaRace],
            ['WNAM', locals.nanaNaked],
            ['FTST', locals.nanaHeadColor]
          ]

          fixedValues.forEach(function (fixedValue) {
            const elementName = fixedValue[0]
            const elementValue = fixedValue[1]

            setElementValue(record, elementName, elementValue)
          })

          const random = Random(xelib.EditorID(record), locals.seed)
          const randomElement = RandomElement(random)

          setElementValue(record, 'HCLF - Hair Color', randomElement(locals.hairColors))

          // TODO faster to overwrite old head parts?
          xelib.GetElements(record, 'Head Parts', true).forEach(element => xelib.RemoveElement(element))

          const preset = randomElement(locals.presets)

          preset.headParts.forEach(
            function (headPart) {
              xelib.AddArrayItem(record, 'Head Parts', '', headPart)
            }
          )

          xelib.AddArrayItem(record, 'Head Parts', '', randomElement(preset.eyes))

          if (xelib.GetIsFemale(record)) {
            xelib.AddArrayItem(record, 'Head Parts', '', randomElement(locals.female.hair))
          } else {
            xelib.AddArrayItem(record, 'Head Parts', '', randomElement(locals.male.hair))
            if (settings.allFemale) {
              xelib.SetIsFemale(record, true)
            }
            /* // facial hair looks silly on the Nanako head
            if (random(4) === 1) {
              xelib.AddArrayItem(record, 'Head Parts', '', randomElement(locals.male.facialHair))
            }
            */
          }
        }
      }
    ]
  })
})
