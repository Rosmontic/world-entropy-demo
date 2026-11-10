import { canPlay, slotsFor } from '../engine'

const MAX_EMPTY_ASSIGNMENTS = 120

export function getAllowedLevels(round) {
  const levels = ['纯净', '萌芽', '灾祸']
  if (round >= 4) levels.push('崩坏')
  if (round >= 7) levels.push('终末')
  levels.push('隐秘')
  return levels
}

export function getLegalCards(state, actor) {
  const slots = slotsFor(actor, state.firstPlayer)
  return state.hands[actor].filter((card) => slots.some((slot) => canPlay(card, slot, state.round)))
}

export function enumerateAssignments(state, actor, allowEmpty = false) {
  const slots = slotsFor(actor, state.firstPlayer)
  const hand = state.hands[actor] || []
  const results = []
  if (!hand.length) return [{ }]

  if (!allowEmpty) {
    const backtrack = (slotIndex, remaining, used, current) => {
      if (slotIndex >= slots.length) {
        results.push({ ...current })
        return
      }
      const slot = slots[slotIndex]
      const playable = remaining.filter((card) => canPlay(card, slot, state.round))
      if (!playable.length) {
        backtrack(slotIndex + 1, remaining, used, current)
        return
      }
      for (const card of playable) {
        if (used.has(card.uid)) continue
        used.add(card.uid)
        current[slot] = card.uid
        backtrack(slotIndex + 1, remaining.filter((item) => item.uid !== card.uid), used, current)
        delete current[slot]
        used.delete(card.uid)
      }
    }
    backtrack(0, hand, new Set(), {})
    return results
  }

  const push = (assignment) => {
    if (results.length < MAX_EMPTY_ASSIGNMENTS) results.push(assignment)
  }

  push({})

  for (const slot of slots) {
    for (const card of hand) {
      if (canPlay(card, slot, state.round)) push({ [slot]: card.uid })
      if (results.length >= MAX_EMPTY_ASSIGNMENTS) return results
    }
  }

  for (let firstSlotIndex = 0; firstSlotIndex < slots.length; firstSlotIndex += 1) {
    for (let secondSlotIndex = firstSlotIndex + 1; secondSlotIndex < slots.length; secondSlotIndex += 1) {
      const slotA = slots[firstSlotIndex]
      const slotB = slots[secondSlotIndex]
      for (const firstCard of hand) {
        if (!canPlay(firstCard, slotA, state.round)) continue
        for (const secondCard of hand) {
          if (firstCard.uid === secondCard.uid || !canPlay(secondCard, slotB, state.round)) continue
          push({ [slotA]: firstCard.uid, [slotB]: secondCard.uid })
          if (results.length >= MAX_EMPTY_ASSIGNMENTS) return results
        }
      }
    }
  }

  for (const firstCard of hand) {
    for (const secondCard of hand) {
      if (firstCard.uid === secondCard.uid) continue
      for (const thirdCard of hand) {
        if (firstCard.uid === thirdCard.uid || secondCard.uid === thirdCard.uid) continue
        const assignment = {}
        const cards = [firstCard, secondCard, thirdCard]
        let valid = true
        for (let index = 0; index < slots.length; index += 1) {
          if (!canPlay(cards[index], slots[index], state.round)) {
            valid = false
            break
          }
          assignment[slots[index]] = cards[index].uid
        }
        if (valid) push(assignment)
        if (results.length >= MAX_EMPTY_ASSIGNMENTS) return results
      }
    }
  }

  return results
}

export const LegalActions = Object.freeze({
  getLegalCards,
  getAllowedLevels,
  enumerateAssignments,
})
