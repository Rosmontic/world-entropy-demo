import {
  beginNextRound,
  completeRound,
  placeCard,
  revealStep,
  selectSlot,
  slotsFor,
  stopTurn,
} from '../engine'

export function cloneState(state) {
  return structuredClone(state)
}

function applyAssignments(state, actor, assignments = {}) {
  let next = state
  for (const slot of slotsFor(actor, next.firstPlayer)) {
    const uid = assignments[slot]
    if (!uid || next.phase !== 'play' || next.turn.player !== actor) continue
    next = placeCard(selectSlot(next, slot), uid)
  }
  if (next.phase === 'play' && next.turn.player === actor) {
    next = stopTurn(next)
  }
  return next
}

export function step(source, action = {}) {
  const state = cloneState(source)
  const actor = action.actor || state.turn.player
  return applyAssignments(state, actor, action.assignments || {})
}

export function settleRound(source, assignments = {}) {
  let state = cloneState(source)
  const players = [state.firstPlayer, state.firstPlayer === 'user' ? 'ai' : 'user']
  for (const player of players) {
    if (state.phase !== 'play') break
    if (state.turn.player !== player) continue
    state = applyAssignments(state, player, assignments[player] || {})
  }
  while (state.phase === 'reveal') state = revealStep(state)
  if (state.phase === 'retain') {
    state = completeRound(
      state,
      assignments.keep?.user?.uid || null,
      assignments.keep?.ai?.uid || null,
    )
  }
  if (state.phase === 'roundEnd') state = beginNextRound(state)
  return state
}

export const AISandbox = Object.freeze({
  cloneState,
  step,
  settleRound,
})
