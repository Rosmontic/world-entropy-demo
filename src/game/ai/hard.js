import {
  MAX_ROUNDS,
  OTHER_PLAYER,
  definition,
  effectiveStats,
  getWinner,
  isTerminal as engineIsTerminal,
} from '../engine'
import { AIConfig, AI_LEVEL_ORDER, AI_TIMEOUT, stageIndex } from './config'
import { chooseKeepByPriority } from './keep'
import { enumerateAssignments } from './legal'
import { RegularPolicy } from './regular'
import { cloneState, step } from './sandbox'

function clamp01(value, label = 'V') {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Invalid ${label}: expected a number in [0, 1], received ${value}`)
  }
  if (value < 0 || value > 1) {
    throw new Error(`Invalid ${label}: expected a number in [0, 1], received ${value}`)
  }
  return value
}

export function getHardCandidateActions(state, actor) {
  return enumerateAssignments(state, actor, true)
}

export function getHardInformationView(state, actor) {
  const opponent = OTHER_PLAYER[actor]
  if (state.firstPlayer === actor) {
    return {
      actor,
      perspective: 'first',
      opponentHand: cloneState(state.hands[opponent] || []),
    }
  }
  return {
    actor,
    perspective: 'second',
    opponentBoard: cloneState((state.board || []).filter((card) => card?.owner === opponent)),
  }
}

export function isTerminal(state) {
  return engineIsTerminal(state)
}

export function evaluateTerminalState(state, actor = 'ai') {
  if (!isTerminal(state)) return null
  const winner = getWinner(state)
  if (winner === 'draw') return 0.5
  return winner === actor ? 1 : 0
}

export function evaluateState(state, context = {}) {
  const actor = context.actor || 'ai'
  if (typeof context.evaluator === 'function') {
    return clamp01(context.evaluator(state, context), 'V')
  }
  const terminalValue = evaluateTerminalState(state, actor)
  if (terminalValue !== null) return terminalValue
  const opponent = OTHER_PLAYER[actor]
  const winBias = (state.wins[actor] - state.wins[opponent]) * 0.08
  const roundBias = (state.round / MAX_ROUNDS) * 0.02
  return clamp01(0.5 + winBias + roundBias, 'V')
}

export function createColdStartHumanModel(config = AIConfig) {
  return {
    predictResponses(state, view, options = {}) {
      const actor = state.turn.player
      const responses = enumerateAssignments(state, actor, true)
      if (!responses.length) return [{ assignment: {}, probability: 1 }]
      const regular = RegularPolicy(state, actor, config, options.aiRng)
      const preferredKey = JSON.stringify(regular.assignments)
      const smoothing = 0.35 / responses.length
      const weighted = responses.map((assignment) => ({
        assignment,
        probability: smoothing + (JSON.stringify(assignment) === preferredKey ? 0.65 : 0),
      }))
      const total = weighted.reduce((sum, item) => sum + item.probability, 0)
      return weighted
        .map((item) => ({ ...item, probability: item.probability / total }))
        .sort((a, b) => b.probability - a.probability)
        .slice(0, options.rolloutCount || config.hard.rolloutCount)
        .map((item, _, list) => {
          const listTotal = list.reduce((sum, entry) => sum + entry.probability, 0)
          return { ...item, probability: item.probability / listTotal }
        })
    },
  }
}

export function expectedValueOverHumanResponses(state, assignment, humanModel, options = {}) {
  const actor = options.actor || 'ai'
  const afterAI = step(state, { actor, assignments: assignment })
  const view = options.view || getHardInformationView(state, actor)
  const responses = humanModel.predictResponses(afterAI, view, {
    aiRng: options.aiRng,
    rolloutCount: options.rolloutCount || AIConfig.hard.rolloutCount,
  })
  const probabilityTotal = responses.reduce((sum, response) => sum + response.probability, 0)
  if (Math.abs(probabilityTotal - 1) > 1e-6 || responses.some((response) => response.probability < 0)) {
    throw new Error(`Human response probabilities must be normalized and non-negative, received total=${probabilityTotal}`)
  }
  let value = 0
  for (const response of responses) {
    const responseValue = typeof response.value === 'number'
      ? response.value
      : evaluateState(step(afterAI, { actor: OTHER_PLAYER[actor], assignments: response.assignment }), options.context || {})
    value += response.probability * clamp01(responseValue, 'V')
  }
  return clamp01(value, 'x')
}

export function calculateHardX(state, actor, assignment, options = {}) {
  if (state.firstPlayer === actor) {
    return expectedValueOverHumanResponses(state, assignment, options.humanModel || createColdStartHumanModel(options.config), {
      ...options,
      actor,
    })
  }
  const next = step(state, { actor, assignments: assignment })
  return clamp01(evaluateState(next, options.context || { actor }), 'x')
}

export function getAcceptFloor(actor, round, config = AIConfig, firstPlayer = null) {
  const isFirst = firstPlayer ? actor === firstPlayer : actor === 'first' || actor === 'user'
  const key = isFirst ? 'FIRST_ACCEPT' : 'SECOND_ACCEPT'
  return config.hard[key][stageIndex(round)]
}

function findCardByUid(state, uid) {
  return [...(state.hands.user || []), ...(state.hands.ai || []), ...(state.board || [])]
    .find((card) => card?.uid === uid)
}

function resourceCost(action, state = null) {
  const entries = Object.entries(action.assignments || action).filter(([, uid]) => Boolean(uid))
  const placed = entries.length
  let levelSum = 0
  let statSum = 0
  for (const [, uid] of entries) {
    const card = state ? findCardByUid(state, uid) : null
    if (!card) continue
    const levelIndex = AI_LEVEL_ORDER.indexOf(definition(card).level)
    levelSum += levelIndex < 0 ? 0 : levelIndex + 1
    statSum += Object.values(effectiveStats(card)).reduce((sum, value) => sum + value, 0)
  }
  return { levelSum, statSum, placed }
}

export function compareResourceCost(actionA, actionB, state = null) {
  const a = resourceCost(actionA, state)
  const b = resourceCost(actionB, state)
  if (a.levelSum !== b.levelSum) return a.levelSum - b.levelSum
  if (a.statSum !== b.statSum) return a.statSum - b.statSum
  return a.placed - b.placed
}

function compareMinimumCostTie(actionA, actionB, state = null) {
  const a = resourceCost(actionA, state)
  const b = resourceCost(actionB, state)
  if (a.placed !== b.placed) return a.placed - b.placed
  if (a.levelSum !== b.levelSum) return a.levelSum - b.levelSum
  return a.statSum - b.statSum
}

export function chooseHardAction(candidates, xValues, state, options = {}) {
  if (!candidates.length || candidates.length !== xValues.length) {
    throw new Error('Hard action candidates and xValues must be non-empty and aligned')
  }
  const xs = xValues.map((value) => clamp01(value, 'x'))
  const config = options.config || AIConfig
  const actor = options.actor || 'ai'
  const acceptFloor = options.acceptFloor ?? getAcceptFloor(actor, state.round, config, state.firstPlayer)
  const lateOrDecisive = state.round >= 7 || (state.wins.user >= 5 && state.wins.ai >= 5)
  const indexed = candidates.map((assignment, index) => ({ assignment, x: xs[index], index }))
  const xMax = Math.max(...xs)

  if (xMax < acceptFloor) {
    const sorted = [...indexed].sort((a, b) => compareResourceCost(a.assignment, b.assignment, state))
    const minimumCost = resourceCost(sorted[0].assignment, state)
    const lowCost = sorted.filter((item) => {
      const cost = resourceCost(item.assignment, state)
      return cost.levelSum === minimumCost.levelSum && cost.statSum === minimumCost.statSum && cost.placed === minimumCost.placed
    })
    const chosen = lowCost.sort((a, b) => b.x - a.x || compareResourceCost(a.assignment, b.assignment, state))[0]
    return { ...chosen, passive: true, acceptFloor, xMax }
  }

  if (lateOrDecisive) {
    const chosen = [...indexed].sort((a, b) => b.x - a.x || compareMinimumCostTie(a.assignment, b.assignment, state))[0]
    return { ...chosen, passive: false, acceptFloor, xMax }
  }

  const eligible = indexed.filter((item) => item.x >= acceptFloor)
  const chosen = eligible.sort((a, b) => a.x - b.x || compareMinimumCostTie(a.assignment, b.assignment, state))[0]
  return { ...chosen, passive: false, acceptFloor, xMax }
}

function fallbackToRegular(state, actor, config, aiRng, timeout, elapsedMs, candidateCount) {
  const fallback = RegularPolicy(state, actor, config, aiRng)
  return {
    ...fallback,
    debug: {
      ...fallback.debug,
      difficulty: 'hard',
      timeout,
      elapsedMs,
      candidateCount,
    },
  }
}

export function HardPolicy(state, actor, config = AIConfig, aiRng = createDeterministicRng(), options = {}) {
  const now = options.now || (() => Date.now())
  const started = now()
  const budget = options.timeBudgetMs ?? config.hard.timeBudgetMs
  const maxCandidates = options.maxCandidates ?? config.hard.maxCandidates
  const candidates = getHardCandidateActions(state, actor).slice(0, maxCandidates)
  const evaluated = []
  let timeout = false

  for (let index = 0; index < candidates.length; index += 1) {
    if (now() - started >= budget) {
      timeout = true
      break
    }
    try {
      const x = calculateHardX(state, actor, candidates[index], {
        ...options,
        aiRng,
        config,
        humanModel: options.humanModel || createColdStartHumanModel(config),
        context: options.context || { actor },
      })
      evaluated.push({ assignment: candidates[index], x })
    } catch (error) {
      if (error?.code === AI_TIMEOUT || error?.message === AI_TIMEOUT) {
        timeout = true
        break
      }
      throw error
    }
  }

  const elapsedMs = now() - started
  if (!evaluated.length) {
    return fallbackToRegular(state, actor, config, aiRng, true, elapsedMs, candidates.length)
  }

  const chosen = chooseHardAction(
    evaluated.map((item) => item.assignment),
    evaluated.map((item) => item.x),
    state,
    { config, actor },
  )
  const assigned = new Set(Object.values(chosen.assignment))
  const handAfterPlay = state.hands[actor].filter((card) => !assigned.has(card.uid))
  const keep = chooseKeepByPriority(handAfterPlay, state.round + 1)

  return {
    assignments: chosen.assignment,
    keepPlan: keep ? { uid: keep.uid, cardId: keep.cardId } : null,
    debug: {
      difficulty: 'hard',
      round: state.round,
      actor,
      candidateCount: candidates.length,
      y: null,
      floor: null,
      xMax: chosen.xMax,
      acceptedX: chosen.x,
      acceptFloor: chosen.acceptFloor,
      passive: chosen.passive,
      timeout,
      elapsedMs,
      assignments: chosen.assignment,
      keep: keep ? { uid: keep.uid, cardId: keep.cardId } : null,
    },
  }
}

function createDeterministicRng() {
  let state = 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}
