import database from '../data/cards.json'

export const DIMENSIONS = [
  { id: 'chaos', name: '混沌', short: '混', color: '#b9a0dc' },
  { id: 'barren', name: '荒芜', short: '荒', color: '#d0a768' },
  { id: 'disqualification', name: '失格', short: '失', color: '#75b7ac' },
  { id: 'calamity', name: '厄孳', short: '厄', color: '#d4777e' },
]

export const CARD_LIST = database.cards
export const CARD_MAP = Object.fromEntries(CARD_LIST.map((card) => [card.id, card]))
export const OTHER_PLAYER = { user: 'ai', ai: 'user' }
export const HAND_LIMIT = 8
export const DECK_MIN_SIZE = 30
export const DECK_MAX_SIZE = 40
export const CARD_COPY_LIMIT = 3
export const LEVEL_DECK_LIMITS = { 灾祸: 12, 崩坏: 7, 终末: 3, 隐秘: 6 }
export const SERIES_OPTIONS = ['均衡', 'A', 'B', 'C', 'O', 'Y']
export const PLAYABLE_CARD_LIST = CARD_LIST.filter((card) => card.id !== 'O1000')

export const DEFAULT_RECIPE = [
  ['A1.1', 3], ['A1.2', 3], ['A1.3', 3], ['A1.4', 2], ['A1.5', 1],
  ['B1.1', 2], ['B1.2', 1], ['B1.3', 3], ['B1.4', 3], ['B1.5', 1],
  ['C1.1', 1], ['C1.2', 1], ['C1.3', 3], ['C1.4', 2], ['C1.5', 1],
]

let uidCounter = 0
const clone = (value) => structuredClone(value)
const clamp = (value) => Math.max(0, Math.min(6, value))

export function definition(card) {
  return CARD_MAP[card.cardId || card.id]
}

export function effectiveStats(card) {
  const result = {}
  for (const dim of DIMENSIONS) {
    const base = card.stats?.[dim.id] ?? 0
    const numeric = typeof base === 'number' ? base : 0
    result[dim.id] = clamp(numeric + (card.tempStats?.[dim.id] || 0))
  }
  return result
}

export function displayStat(card, dim) {
  const base = card.stats?.[dim]
  if (base === '-' || base === '?') return base
  return effectiveStats(card)[dim]
}

function makeInstance(cardId, owner, generated = false) {
  const def = CARD_MAP[cardId]
  uidCounter += 1
  return {
    uid: `${owner}-${Date.now().toString(36)}-${uidCounter}`,
    cardId,
    owner,
    stats: clone(def.stats),
    keywords: [...def.keywords],
    tempStats: {},
    generated,
    faceUp: false,
    hasRevealed: false,
  }
}

export function shuffle(items, rng = Math.random) {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function randomDimensions(rng = Math.random) {
  return shuffle(DIMENSIONS.map((dim) => dim.id), rng).slice(0, 2)
}

export function normalizeDeckRecipe(recipe) {
  if (!Array.isArray(recipe)) return []
  return recipe
    .map(([id, count]) => [id, Math.max(0, Math.floor(Number(count) || 0))])
    .filter(([, count]) => count > 0)
}

export function validateDeckRecipe(recipe) {
  const errors = []
  const levelCounts = {}
  const cardCounts = {}
  let total = 0

  for (const [id, count] of normalizeDeckRecipe(recipe)) {
    const def = CARD_MAP[id]
    if (!def) {
      errors.push(`未知卡牌：${id}`)
      continue
    }
    if (id === 'O1000') {
      errors.push('O1000是系统备用卡，不能进入卡组')
      continue
    }
    if (count > CARD_COPY_LIMIT) errors.push(`「${def.name}」同名至多${CARD_COPY_LIMIT}张`)
    total += count
    cardCounts[id] = (cardCounts[id] || 0) + count
    levelCounts[def.level] = (levelCounts[def.level] || 0) + count
    const levelLimit = LEVEL_DECK_LIMITS[def.level]
    if (levelLimit && levelCounts[def.level] > levelLimit) {
      errors.push(`${def.level}级合计至多${levelLimit}张`)
    }
  }

  if (total < DECK_MIN_SIZE) errors.push(`卡组至少${DECK_MIN_SIZE}张`)
  if (total > DECK_MAX_SIZE) errors.push(`卡组至多${DECK_MAX_SIZE}张`)

  return {
    valid: errors.length === 0,
    total,
    levelCounts,
    cardCounts,
    errors: [...new Set(errors)],
  }
}

export function buildRandomDeckRecipe({ tendency = '均衡', rng = Math.random } = {}) {
  const targetSize = DECK_MIN_SIZE + Math.floor(rng() * (DECK_MAX_SIZE - DECK_MIN_SIZE + 1))
  const recipe = new Map()
  const cardCounts = {}
  const levelCounts = {}

  const canAdd = (def) => {
    if ((cardCounts[def.id] || 0) >= CARD_COPY_LIMIT) return false
    const levelLimit = LEVEL_DECK_LIMITS[def.level]
    return !levelLimit || (levelCounts[def.level] || 0) < levelLimit
  }
  const addCard = (def) => {
    recipe.set(def.id, (recipe.get(def.id) || 0) + 1)
    cardCounts[def.id] = (cardCounts[def.id] || 0) + 1
    levelCounts[def.level] = (levelCounts[def.level] || 0) + 1
  }
  const fill = (pool, amount) => {
    for (let index = 0; index < amount; index += 1) {
      const legal = pool.filter(canAdd)
      if (!legal.length) return false
      addCard(legal[Math.floor(rng() * legal.length)])
    }
    return true
  }

  if (tendency !== '均衡') {
    const selectedPool = PLAYABLE_CARD_LIST.filter((card) => card.series === tendency)
    const selectedTarget = Math.round(targetSize * (0.45 + rng() * 0.2))
    fill(selectedPool, selectedTarget)
  }
  fill(PLAYABLE_CARD_LIST, targetSize - [...recipe.values()].reduce((sum, count) => sum + count, 0))

  return [...recipe.entries()]
}

export function buildDeck(owner, recipe = DEFAULT_RECIPE) {
  const safeRecipe = validateDeckRecipe(recipe).valid ? normalizeDeckRecipe(recipe) : DEFAULT_RECIPE
  return shuffle(safeRecipe.flatMap(([id, count]) => Array.from({ length: count }, () => makeInstance(id, owner))))
}

function addLog(state, text, type = 'system') {
  state.logs.unshift({ id: `${Date.now()}-${Math.random()}`, round: state.round, text, type })
  state.logs = state.logs.slice(0, 80)
}

function drawOne(state, player) {
  if (state.hands[player].length >= HAND_LIMIT) return null
  if (state.decks[player].length === 0 && state.discards[player].length > 0) {
    state.decks[player] = shuffle(state.discards[player])
    state.discards[player] = []
    addLog(state, `${player === 'user' ? '你' : '对手'}将弃牌区洗回牌库。`)
  }
  const card = state.decks[player].shift()
  if (!card) return null
  state.hands[player].push(card)
  return card
}

export function drawToFive(state, player) {
  while (state.hands[player].length < 5) {
    if (!drawOne(state, player)) break
  }
}

export function createGame({ userRecipe, aiRecipe } = {}) {
  const state = {
    round: 1,
    wins: { user: 0, ai: 0 },
    firstPlayer: 'user',
    phase: 'play',
    dimensions: randomDimensions(),
    turn: { player: 'user', index: 0 },
    board: Array(6).fill(null),
    hands: { user: [], ai: [] },
    decks: { user: buildDeck('user', userRecipe), ai: buildDeck('ai', aiRecipe) },
    discards: { user: [], ai: [] },
    exiles: { user: [], ai: [], system: [] },
    logs: [],
    revealQueue: [],
    revealIndex: 0,
    roundResult: null,
    gameWinner: null,
  }
  drawToFive(state, 'user')
  drawToFive(state, 'ai')
  addLog(state, '第一次校订开始。你获得先手。', 'important')
  addLog(state, `本回合维度：${state.dimensions.map((id) => DIMENSIONS.find((d) => d.id === id).name).join('、')}。`)
  return state
}

export function slotsFor(player, firstPlayer) {
  return player === firstPlayer ? [1, 3, 5] : [2, 4, 6]
}

export function currentSlot(state) {
  if (state.phase !== 'play') return null
  return slotsFor(state.turn.player, state.firstPlayer)[state.turn.index]
}

export function canPlay(card, slot, round) {
  const def = definition(card)
  const levelAllowed = def.level === '隐秘'
    || (def.level === '终末' ? round >= 7 : def.level === '崩坏' ? round >= 4 : true)
  if (!levelAllowed) return false
  if (def.keywords.includes('中枢') && slot !== 1) return false
  if (def.keywords.includes('边界') && slot === 1) return false
  return true
}

function modifyStat(state, card, dim, amount, temporary = false) {
  const def = definition(card)
  if (def.effect === 'emptySky') return
  if (def.effect === 'silentPact' && amount > 0) return
  if (temporary) {
    card.tempStats ||= {}
    card.tempStats[dim] = (card.tempStats[dim] || 0) + amount
    const base = typeof card.stats[dim] === 'number' ? card.stats[dim] : 0
    card.tempStats[dim] = clamp(base + card.tempStats[dim]) - base
  } else {
    const base = typeof card.stats[dim] === 'number' ? card.stats[dim] : 0
    card.stats[dim] = clamp(base + amount)
  }
}

function revealInstance(state, slot) {
  const card = state.board[slot - 1]
  if (!card || card.hasRevealed) return
  card.faceUp = true
  card.hasRevealed = true
  const def = definition(card)
  for (const dim of DIMENSIONS) {
    if (card.stats[dim.id] === '?') card.stats[dim.id] = 1 + Math.floor(Math.random() * 6)
  }
  addLog(state, `${slot}号位「${def.name}」显现。`, 'reveal')
  applyRevealEffect(state, slot)
}

function applyRevealEffect(state, slot) {
  const card = state.board[slot - 1]
  if (!card) return
  const def = definition(card)
  const player = card.owner
  const opponent = OTHER_PLAYER[player]
  const stats = effectiveStats(card)

  switch (def.effect) {
    case 'antNest': {
      modifyStat(state, card, 'barren', -1)
      const target = slot > 1 ? state.board[slot - 2] : null
      if (target?.faceUp) {
        modifyStat(state, target, 'barren', 2)
        addLog(state, `蚁穴令${slot - 1}号位荒芜＋2。`, 'effect')
      }
      break
    }
    case 'famine': {
      let count = 0
      state.board.forEach((target, index) => {
        if (target && index !== slot - 1 && target.faceUp) {
          modifyStat(state, target, 'barren', 1)
          count += 1
        }
      })
      addLog(state, `饥馑扩散，影响${count}张明牌。`, 'effect')
      break
    }
    case 'bloom': {
      if (state.hands[opponent].length < HAND_LIMIT) {
        const copy = makeInstance('C31', opponent, true)
        copy.keywords.push('放逐')
        state.hands[opponent].push(copy)
        addLog(state, `椛在${opponent === 'user' ? '你的' : '对手的'}手牌中生成复制。`, 'effect')
      }
      break
    }
    case 'rain': {
      const drawn = drawOne(state, player)
      if (drawn) {
        modifyStat(state, drawn, 'disqualification', 2, true)
        addLog(state, `雨季令抽到的「${definition(drawn).name}」本回合失格＋2。`, 'effect')
      }
      break
    }
    case 'mirror': {
      const target = slot > 1 ? state.board[slot - 2] : null
      if (target?.faceUp) {
        card.stats = effectiveStats(target)
        addLog(state, `镜子复制了${slot - 1}号位的当前四维。`, 'effect')
      }
      break
    }
    case 'proliferate': {
      if (state.hands[player].length < HAND_LIMIT) {
        const copy = makeInstance('A66', player, true)
        copy.stats = clone(stats)
        copy.keywords.push('放逐')
        state.hands[player].push(copy)
        addLog(state, '增殖生成了一张当前四维的复制。', 'effect')
      }
      break
    }
    case 'faces': {
      const pool = ['barren', 'disqualification', 'calamity']
      const chosen = pool[Math.floor(Math.random() * pool.length)]
      state.board.forEach((target, index) => {
        if (target && index > 0 && index !== slot - 1 && target.faceUp) {
          const targetStats = effectiveStats(target)
          target.stats.chaos = targetStats[chosen]
          target.stats[chosen] = targetStats.chaos
        }
      })
      addLog(state, `千面交换里世界的混沌与${DIMENSIONS.find((d) => d.id === chosen).name}。`, 'effect')
      break
    }
    case 'lighthouse': {
      const target = slot < 6 ? state.board[slot] : null
      if (target && !target.faceUp) {
        addLog(state, `观测灯塔提前照亮${slot + 1}号位。`, 'effect')
        revealInstance(state, slot + 1)
      }
      break
    }
    default:
      break
  }
}

function beginReveal(state) {
  state.phase = 'reveal'
  const normal = []
  const dark = []
  state.board.forEach((card, index) => {
    if (!card || card.faceUp) return
    if (definition(card).keywords.includes('暗牌')) dark.push(index + 1)
    else normal.push(index + 1)
  })
  state.revealQueue = [...normal, ...dark]
  state.revealIndex = 0
  addLog(state, '所有世界已放置，开始依次显现。', 'important')
}

function advanceTurn(state) {
  if (state.turn.index < 2) {
    state.turn.index += 1
    return
  }
  if (state.turn.player === state.firstPlayer) {
    state.turn.player = OTHER_PLAYER[state.firstPlayer]
    state.turn.index = 0
  } else {
    beginReveal(state)
  }
}

export function placeCard(source, uid) {
  if (source.phase !== 'play') return source
  const state = clone(source)
  const player = state.turn.player
  const slot = currentSlot(state)
  const handIndex = state.hands[player].findIndex((card) => card.uid === uid)
  if (handIndex < 0 || !canPlay(state.hands[player][handIndex], slot, state.round)) return source
  const [card] = state.hands[player].splice(handIndex, 1)
  card.faceUp = definition(card).keywords.includes('明牌') || (slot === 1 && !definition(card).keywords.includes('暗牌'))
  state.board[slot - 1] = card
  addLog(state, `${player === 'user' ? '你' : '对手'}将一张牌放入${slot}号位。`)
  if (card.faceUp) revealInstance(state, slot)
  advanceTurn(state)
  return state
}

function ensureMainWorld(state) {
  if (state.board[0]) return
  const card = makeInstance('O1000', 'system', true)
  card.faceUp = true
  state.board[0] = card
  addLog(state, '系统将「存在」置入空缺的1号位。', 'important')
  revealInstance(state, 1)
}

export function skipSlot(source) {
  if (source.phase !== 'play') return source
  const state = clone(source)
  const slot = currentSlot(state)
  addLog(state, `${state.turn.player === 'user' ? '你' : '对手'}跳过${slot}号位。`)
  if (slot === 1 && state.turn.player === state.firstPlayer) ensureMainWorld(state)
  advanceTurn(state)
  return state
}

export function stopTurn(source) {
  if (source.phase !== 'play') return source
  const state = clone(source)
  addLog(state, `${state.turn.player === 'user' ? '你' : '对手'}停止出牌。`)
  if (state.turn.player === state.firstPlayer) {
    ensureMainWorld(state)
    state.turn.player = OTHER_PLAYER[state.firstPlayer]
    state.turn.index = 0
  } else {
    beginReveal(state)
  }
  return state
}

function mainStat(main, dim) {
  if (!main) return 0
  if (definition(main).effect === 'emptySky') return 2
  return effectiveStats(main)[dim]
}

export function calculateScores(state) {
  const main = state.board[0]
  const dims = main?.faceUp && definition(main).effect === 'emptySky'
    ? DIMENSIONS.map((dim) => dim.id)
    : state.dimensions
  let firstScore = 0
  let secondScore = 0
  for (const dim of dims) {
    const multiplier = mainStat(main, dim)
    const firstInner = [3, 5].reduce((sum, slot) => sum + (state.board[slot - 1] ? effectiveStats(state.board[slot - 1])[dim] : 0), 0)
    const secondInner = [2, 4, 6].reduce((sum, slot) => sum + (state.board[slot - 1] ? effectiveStats(state.board[slot - 1])[dim] : 0), 0)
    firstScore += multiplier * firstInner
    secondScore += multiplier * secondInner
  }
  firstScore = Math.max(0, firstScore)
  secondScore = Math.max(0, secondScore)
  return {
    dimensions: dims,
    firstScore,
    secondScore,
    userScore: state.firstPlayer === 'user' ? firstScore : secondScore,
    aiScore: state.firstPlayer === 'ai' ? firstScore : secondScore,
  }
}

export function revealStep(source) {
  if (source.phase !== 'reveal') return source
  const state = clone(source)
  while (state.revealIndex < state.revealQueue.length) {
    const slot = state.revealQueue[state.revealIndex]
    state.revealIndex += 1
    const card = state.board[slot - 1]
    if (card && !card.faceUp) {
      revealInstance(state, slot)
      return state
    }
  }
  const result = calculateScores(state)
  const winner = result.firstScore === result.secondScore ? 'tie' : result.firstScore > result.secondScore ? state.firstPlayer : OTHER_PLAYER[state.firstPlayer]
  if (winner === 'tie') {
    state.wins.user += 1
    state.wins.ai += 1
  } else {
    state.wins[winner] += 1
  }
  state.roundResult = { ...result, winner }
  state.phase = 'roundEnd'
  addLog(state, `计分完成：你 ${result.userScore}／对手 ${result.aiScore}。`, 'important')
  if ((state.wins.user >= 5) !== (state.wins.ai >= 5)) {
    state.gameWinner = state.wins.user >= 5 ? 'user' : 'ai'
    state.phase = 'gameOver'
  }
  return state
}

export function openRetention(source) {
  if (source.phase !== 'roundEnd') return source
  const state = clone(source)
  state.phase = 'retain'
  return state
}

export function chooseAiRetain(state) {
  const hand = state.hands.ai
  if (!hand.length) return null
  return [...hand].sort((a, b) => {
    const score = (card) => {
      const def = definition(card)
      const total = Object.values(effectiveStats(card)).reduce((sum, value) => sum + value, 0)
      return total + (def.effect === 'hive' ? 12 : 0) + (def.level === '终末' && state.round >= 5 ? 8 : 0)
    }
    return score(b) - score(a)
  })[0].uid
}

function discardCard(state, card) {
  const owner = card.owner
  card.faceUp = false
  card.hasRevealed = false
  card.tempStats = {}
  if (card.keywords.includes('放逐') || card.generated) state.exiles[owner].push(card)
  else state.discards[owner].push(card)
}

function retainCard(state, player, uid) {
  const retained = state.hands[player].filter((card) => card.uid === uid)
  const discarded = state.hands[player].filter((card) => card.uid !== uid)
  discarded.forEach((card) => discardCard(state, card))
  state.hands[player] = retained
  if (retained[0]) {
    retained[0].tempStats = {}
    if (definition(retained[0]).effect === 'hive') {
      modifyStat(state, retained[0], 'chaos', 1)
      addLog(state, `${player === 'user' ? '你的' : '对手的'}蜂巢因保留而混沌＋1。`, 'effect')
    }
  }
}

export function completeRound(source, userRetainUid = null) {
  if (source.phase !== 'retain') return source
  const state = clone(source)
  state.board.forEach((card) => card && discardCard(state, card))
  retainCard(state, 'user', userRetainUid)
  retainCard(state, 'ai', chooseAiRetain(state))
  state.round += 1
  state.firstPlayer = state.round % 2 === 1 ? 'user' : 'ai'
  state.board = Array(6).fill(null)
  state.dimensions = randomDimensions()
  state.turn = { player: state.firstPlayer, index: 0 }
  state.phase = 'play'
  state.roundResult = null
  state.revealQueue = []
  state.revealIndex = 0
  drawToFive(state, 'user')
  drawToFive(state, 'ai')
  addLog(state, `第${state.round}回合开始，${state.firstPlayer === 'user' ? '你' : '对手'}先手。`, 'important')
  addLog(state, `本回合维度：${state.dimensions.map((id) => DIMENSIONS.find((d) => d.id === id).name).join('、')}。`)
  return state
}

export function chooseAiCard(state) {
  const slot = currentSlot(state)
  if (!slot) return null
  const legal = state.hands.ai.filter((card) => canPlay(card, slot, state.round))
  if (!legal.length) return null
  const score = (card) => {
    const def = definition(card)
    const stats = effectiveStats(card)
    const dimScore = state.dimensions.reduce((sum, dim) => sum + stats[dim], 0)
    let bonus = Math.random() * 0.8
    if (slot === 1) {
      const handPotential = state.hands.ai.reduce((sum, item) => {
        if (item.uid === card.uid) return sum
        const values = effectiveStats(item)
        return sum + state.dimensions.reduce((n, dim) => n + values[dim], 0)
      }, 0)
      bonus += dimScore * Math.min(2, handPotential / 20)
      if (def.effect === 'emptySky') bonus += 8
      if (def.effect === 'silentPact') bonus += 1
    } else {
      if (def.effect === 'mirror') {
        const previous = state.board[slot - 2]
        if (previous?.faceUp) bonus += state.dimensions.reduce((sum, dim) => sum + effectiveStats(previous)[dim], 0)
      }
      if (['famine', 'proliferate', 'faces', 'bloom'].includes(def.effect)) bonus += 2
    }
    return dimScore + bonus
  }
  return [...legal].sort((a, b) => score(b) - score(a))[0].uid
}

export function phaseName(state) {
  return {
    play: '出牌阶段', reveal: '拼点阶段', roundEnd: '结算完成', retain: '弃牌与保留', gameOver: '校订结束',
  }[state.phase] || state.phase
}
