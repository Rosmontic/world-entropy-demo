export const AI_TIMEOUT = 'AI_TIMEOUT'

export class AITimeoutError extends Error {
  constructor(message = 'AI_TIMEOUT') {
    super(message)
    this.code = AI_TIMEOUT
  }
}

export const AI_LEVEL_ORDER = ['纯净', '萌芽', '灾祸', '崩坏', '终末', '隐秘']

export const AIConfig = Object.freeze({
  difficulty: 'regular',
  FIRST_COMPENSATION: 0,
  beginner: Object.freeze({}),
  regular: Object.freeze({
    FIRST_FLOOR: Object.freeze([15, 35, 45]),
    SECOND_FLOOR: Object.freeze([28, 59, 74]),
  }),
  hard: Object.freeze({
    FIRST_ACCEPT: Object.freeze([0.5, 0.5, 0.5]),
    SECOND_ACCEPT: Object.freeze([0.5, 0.5, 0.5]),
    maxCandidates: 120,
    rolloutCount: 16,
    timeBudgetMs: 250,
    timeoutFallback: 'regular',
  }),
  keepMax: 1,
})

export function stageIndex(round) {
  if (round <= 3) return 0
  if (round <= 6) return 1
  return 2
}
