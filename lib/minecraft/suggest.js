/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * lib/minecraft/suggest.js — Smart Typo Suggestion Engine ("Did You Mean?")
 */

export function levenshteinDistance(s1, s2) {
  const a = String(s1 || '').toLowerCase()
  const b = String(s2 || '').toLowerCase()
  const costs = []
  for (let i = 0; i <= a.length; i++) {
    let lastValue = i
    for (let j = 0; j <= b.length; j++) {
      if (i === 0) costs[j] = j
      else if (j > 0) {
        let newValue = costs[j - 1]
        if (a.charAt(i - 1) !== b.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
        }
        costs[j - 1] = lastValue
        lastValue = newValue
      }
    }
    if (i > 0) costs[b.length] = lastValue
  }
  return costs[b.length]
}

export function stringSimilarity(s1, s2) {
  const a = String(s1 || '').toLowerCase()
  const b = String(s2 || '').toLowerCase()
  const longer = a.length >= b.length ? a : b
  const shorter = a.length < b.length ? a : b
  if (longer.length === 0) return 1.0
  return (longer.length - levenshteinDistance(longer, shorter)) / longer.length
}

export const POPULAR_BEDROCK_ADDONS = [
  'RLCraft',
  'Better on Bedrock',
  'Actions & Stuff',
  'Realism VFX',
  'Furnicraft',
  'Security Craft',
  'Mutant Creatures',
  'Dynamic Light',
  'True Survival Zombie Apocalypse',
  'Morph Plus',
  'Epic Fight',
  'Weapon Custom',
  'Modern Warfare',
  'Insane Monsters',
  'Medieval Furniture',
  'Dragon Mounts',
  'Lucky Block',
  'One Block Survival',
  'Skyblock Evolution',
  'Pokédrock',
  'Origins Mod',
  'More Tools',
  'Expansive Fantasy',
  'Dinosaurs Time',
  'Vehicle Car Addon',
  'Guns Warfare',
  'SCP Foundation',
  'Shader Ultra',
  'Definitive Animation',
  'Waypoints System',
  'Vanilla Vehicles'
]

export async function findSuggestion(query, engine, _cfEngine) {
  if (!query || typeof query !== 'string') return null
  const cleanQuery = query.trim().toLowerCase()
  if (cleanQuery.length < 3) return null

  let bestStaticMatch = null
  let highestStaticSim = 0
  const queryWords = cleanQuery.split(/\s+/).filter(Boolean)

  for (const name of POPULAR_BEDROCK_ADDONS) {
    const nameLower = name.toLowerCase()
    const sim = stringSimilarity(cleanQuery, nameLower)
    const nameWords = nameLower.split(/\s+/).filter(Boolean)

    let wordMatchCount = 0
    for (const qw of queryWords) {
      for (const nw of nameWords) {
        if (stringSimilarity(qw, nw) >= 0.72) {
          wordMatchCount++
          break
        }
      }
    }
    const wordRatio = wordMatchCount / Math.max(queryWords.length, 1)
    const combinedScore = Math.max(sim, wordRatio * 0.9)

    if (combinedScore > highestStaticSim && combinedScore >= 0.68) {
      highestStaticSim = combinedScore
      bestStaticMatch = name
    }
  }

  if (bestStaticMatch && highestStaticSim >= 0.68) {
    return {
      suggestedQuery: bestStaticMatch,
      confidence: highestStaticSim,
      source: 'popular_catalog'
    }
  }

  if (engine && typeof engine.search === 'function') {
    try {
      const fuzzyWords = queryWords.map((w) => (w.length >= 4 ? `${w}~` : w))
      const fuzzyQuery = fuzzyWords.join(' ')
      const res = await engine.search(fuzzyQuery, 5)
      const items = Array.isArray(res) ? res : (res?.items ?? [])

      for (const item of items) {
        const rawTitle = item.Title?.neutral || item.Title?.NEUTRAL || item.Title || ''
        if (!rawTitle) continue

        const cleanTitle = rawTitle
          .replace(/\s+(v?\d+(\.\d+)*|add-?on|minecraft|bedrock|edition)\b/gi, '')
          .trim()
        const sim = stringSimilarity(cleanQuery, cleanTitle.toLowerCase())

        const titleWords = rawTitle.toLowerCase().split(/\s+/).filter(Boolean)
        let matchCount = 0
        let matchedWordOriginal = ''
        for (const qw of queryWords) {
          for (const tw of titleWords) {
            if (stringSimilarity(qw, tw) >= 0.72) {
              matchCount++
              matchedWordOriginal = tw
              break
            }
          }
        }

        if (sim >= 0.65 || (matchCount >= queryWords.length && matchCount > 0)) {
          let resultSuggestion = cleanTitle
          if (queryWords.length === 1 && matchedWordOriginal) {
            const orig = rawTitle
              .split(/\s+/)
              .find((w) => w.toLowerCase() === matchedWordOriginal.toLowerCase())
            if (orig) resultSuggestion = orig.replace(/[^a-zA-Z0-9]/g, '')
          }

          return {
            suggestedQuery: resultSuggestion || cleanTitle,
            confidence: sim,
            source: 'marketplace_fuzzy'
          }
        }
      }
    } catch {}
  }

  return null
}
