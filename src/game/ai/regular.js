import { definition, effectiveStats, slotsFor } from '../engine'
import { AIConfig, AI_LEVEL_ORDER, stageIndex } from './config'
import { chooseKeepByPriority } from './keep'
import { enumerateAssignments, getLegalCards } from './legal'

const ZERO_STATS = { chaos: 0, barren: 0, disqualification: 0, calamity: 0 }

export function slotScore(card, mainCard, dims) {
  const cardStats = effectiveStats(card)
  const mainStats = mainCard ? effectiveStats(mainCard) : ZERO_STATS
  return dims.reduce((sum, dim) => sum + mainStats[dim] * cardStats[dim], 0)
}

function assignmentCard(state, assignments, slot) {
  const uid = assignments[slot]
  if (!uid) return null
  return state.hands[state.turn.player]?.find((card) => card.uid === uid)
    || state.hands.user.find((card) => card.uid === uid)
    || state.hands.ai.find((card) => card.uid === uid)
    || null
}

export function scoreAssignment(state, actor, assignments) {
  const dims = state.dimensions
  const positions = slotsFor(actor, state.firstPlayer)
  const mainCard = actor === state.firstPlayer
    ? assignmentCard(state, assignments, 1)
    : state.board[0]
  let y = 0
  for (const slot of positions) {
    const card = assignmentCard(state, assignments, slot)
    if (card) y += slotScore(card, mainCard, dims)
  }
  return y
}

export function getBestScoringAssignment(state, actor) {
  const candidates = enumerateAssignments(state, actor, false)
  let best = { assignments: {}, y: Number.NEGATIVE_INFINITY }
  for (const assignments of candidates) {
    const y = scoreAssignment(state, actor, assignments)
    if (y > best.y) best = { assignments, y }
  }
  if (best.y === Number.NEGATIVE_INFINITY) return { assignments: {}, y: 0 }
  return best
}

function levelValue(card) {
  const index = AI_LEVEL_ORDER.indexOf(definition(card).level)
  return index < 0 ? 0 : index + 1
}

function totalStats(card) {
  return Object.values(effectiveStats(card)).reduce((sum, value) => sum + value, 0)
}

export function fillWithLowestValueCards(state, actor) {
  const positions = slotsFor(actor, state.firstPlayer)
  const pool = [...getLegalCards(state, actor)].sort((a, b) => {
    const levelDifference = levelValue(a) - levelValue(b)
    if (levelDifference) return levelDifference
    return totalStats(a) - totalStats(b)
  })
  const assignments = {}
  for (const slot of positions) {
    const index = pool.findIndex((card) => definition(card).keywords.includes('中枢')
      ? slot === 1
      : definition(card).keywords.includes('边界')
        ? slot !== 1
        : true)
    if (index < 0) continue
    const [card] = pool.splice(index, 1)
    assignments[slot] = card.uid
  }
  return assignments
}

export function getScoreFloor(actor, round, config = AIConfig, firstPlayer = null) {
  const isFirst = firstPlayer ? actor === firstPlayer : actor === 'first' || actor === 'user'
  const key = isFirst ? 'FIRST_FLOOR' : 'SECOND_FLOOR'
  return config.regular[key][stageIndex(round)]
}

export function RegularPolicy(state, actor, config = AIConfig, _aiRng = null) {
  const best = getBestScoringAssignment(state, actor)
  const floor = getScoreFloor(actor, state.round, config, state.firstPlayer)
  const passive = best.y < floor
  const assignments = passive ? fillWithLowestValueCards(state, actor) : best.assignments
  const assigned = new Set(Object.values(assignments))
  const handAfterPlay = state.hands[actor].filter((card) => !assigned.has(card.uid))
  const keep = chooseKeepByPriority(handAfterPlay, state.round + 1)

  return {
    assignments,
    keepPlan: keep ? { uid: keep.uid, cardId: keep.cardId } : null,
    debug: {
      difficulty: 'regular',
      round: state.round,
      actor,
      candidateCount: enumerateAssignments(state, actor, false).length,
      y: best.y,
      floor,
      xMax: null,
      acceptedX: null,
      acceptFloor: null,
      passive,
      timeout: false,
      elapsedMs: 0,
      assignments,
      keep: keep ? { uid: keep.uid, cardId: keep.cardId } : null,
    },
  }
}
