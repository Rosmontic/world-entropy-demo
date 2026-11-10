import { canPlay, shuffle, slotsFor } from '../engine'
import { getLegalCards } from './legal'

export function BeginnerPolicy(state, actor, config, aiRng) {
  const positions = slotsFor(actor, state.firstPlayer)
  const pool = shuffle([...getLegalCards(state, actor)], aiRng)
  const assignments = {}

  for (const slot of positions) {
    const index = pool.findIndex((card) => canPlay(card, slot, state.round))
    if (index < 0) continue
    const [card] = pool.splice(index, 1)
    assignments[slot] = card.uid
  }

  return {
    assignments,
    keepPlan: null,
    debug: {
      difficulty: 'beginner',
      round: state.round,
      actor,
      candidateCount: pool.length + Object.keys(assignments).length,
      y: null,
      floor: null,
      xMax: null,
      acceptedX: null,
      acceptFloor: null,
      passive: false,
      timeout: false,
      elapsedMs: 0,
      assignments,
      keep: null,
    },
  }
}
