import {
  calculateScores,
  canPlay,
  effectiveStats,
} from '../engine'
import { BeginnerPolicy } from './beginner'
import { AIConfig, AITimeoutError, AI_TIMEOUT } from './config'
import { getAllowedLevels, getLegalCards, enumerateAssignments, LegalActions } from './legal'
import { createAIRng } from './rng'
import { KeepPolicy } from './keep'
import { RegularPolicy, getBestScoringAssignment, getScoreFloor, slotScore } from './regular'
import {
  HardPolicy,
  calculateHardX,
  chooseHardAction,
  compareResourceCost,
  evaluateState,
  evaluateTerminalState,
  expectedValueOverHumanResponses,
  getAcceptFloor,
  getHardCandidateActions,
  getHardInformationView,
} from './hard'
import { AISandbox, cloneState, settleRound, step } from './sandbox'
import { recordTelemetry } from './telemetry'

export const AI_DIFFICULTIES = Object.freeze(['beginner', 'regular', 'hard'])

export function chooseAction(state, actor, difficulty = 'regular', config = AIConfig, aiRng = createAIRng('ai')) {
  if (!AI_DIFFICULTIES.includes(difficulty)) {
    throw new Error(`Unknown AI difficulty: ${difficulty}`)
  }
  if (typeof aiRng !== 'function') {
    throw new Error('chooseAction requires an aiRng function')
  }

  let result
  if (difficulty === 'beginner') result = BeginnerPolicy(state, actor, config, aiRng)
  else if (difficulty === 'regular') result = RegularPolicy(state, actor, config, aiRng)
  else result = HardPolicy(state, actor, config, aiRng)

  const debug = {
    xMax: null,
    acceptedX: null,
    acceptFloor: null,
    timeout: false,
    elapsedMs: 0,
    ...result.debug,
    difficulty,
    round: state.round,
    actor,
  }
  recordTelemetry(debug)
  return { assignments: result.assignments, keepPlan: result.keepPlan, debug }
}

export const RulesEngine = Object.freeze({
  getLegalCards,
  getAllowedLevels,
  enumerateAssignments,
  step,
  settleRound,
  getEffectiveDims: (card) => effectiveStats(card),
  getAllowedSlots: (state, actor) => (state.hands[actor] || [])
    .filter((card) => getLegalCards(state, actor).includes(card))
    .map((card) => ({ card, slots: [1, 3, 5, 2, 4, 6].filter((slot) => canPlay(card, slot, state.round)) })),
  isTerminal: (state) => state.phase === 'gameOver',
  getWinner: (state) => (state.phase === 'gameOver' ? state.gameWinner : null),
  calculateScores,
})

export {
  AIConfig,
  AITimeoutError,
  AI_TIMEOUT,
  AISandbox,
  BeginnerPolicy,
  LegalActions,
  RegularPolicy,
  HardPolicy,
  KeepPolicy,
  createAIRng,
  cloneState,
  step,
  settleRound,
  getLegalCards,
  getAllowedLevels,
  enumerateAssignments,
  getBestScoringAssignment,
  getScoreFloor,
  slotScore,
  getHardCandidateActions,
  getHardInformationView,
  calculateHardX,
  chooseHardAction,
  compareResourceCost,
  evaluateState,
  evaluateTerminalState,
  expectedValueOverHumanResponses,
  getAcceptFloor,
}
