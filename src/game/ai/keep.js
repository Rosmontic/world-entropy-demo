import { definition, effectiveStats } from '../engine'
import { AI_LEVEL_ORDER } from './config'
import { getAllowedLevels } from './legal'

function levelValue(level) {
  const index = AI_LEVEL_ORDER.indexOf(level)
  return index < 0 ? 0 : index + 1
}

function totalStats(card) {
  return Object.values(effectiveStats(card)).reduce((sum, value) => sum + value, 0)
}

export function chooseKeepByPriority(hand, nextRound) {
  const allowed = new Set(getAllowedLevels(nextRound))
  const candidates = hand.filter((card) => allowed.has(definition(card).level))
  if (!candidates.length) return null
  return [...candidates].sort((a, b) => {
    const totalDifference = totalStats(b) - totalStats(a)
    if (totalDifference) return totalDifference
    return levelValue(definition(b).level) - levelValue(definition(a).level)
  })[0]
}

export const KeepPolicy = Object.freeze({
  chooseKeepByPriority,
})
