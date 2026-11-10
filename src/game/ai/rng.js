import { seededRandom } from '../engine'

export function createAIRng(seed) {
  return seededRandom(seed)
}
