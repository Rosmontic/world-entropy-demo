import { afterEach, describe, expect, it } from 'vitest'
import {
  CARD_MAP, DEFAULT_RECIPE, DISCARD_LIMIT, LEVEL_DECK_LIMITS, addCardToDeck,
  beginNextRound, buildRandomDeckRecipe, calculateScores, canPlay, completeRound,
  createGame, effectiveStats, placeCard, revealStep, selectSlot, skipSlot, stopTurn,
  validateDeckRecipe, sortCardsForDisplay,
} from './engine'

const restoreStack = []

function patchCard(id, patch) {
  const original = structuredClone(CARD_MAP[id])
  restoreStack.push(() => { CARD_MAP[id] = original })
  Object.assign(CARD_MAP[id], patch)
}

afterEach(() => {
  while (restoreStack.length) restoreStack.pop()()
})

function makeCard(id, overrides = {}) {
  const def = CARD_MAP[id]
  return {
    uid: overrides.uid || `${id}-${Math.random()}`,
    cardId: id,
    owner: 'user',
    stats: { ...def.stats },
    keywords: [...def.keywords],
    permanentStats: {},
    tempStats: {},
    auraStats: {},
    tempExpiryRound: null,
    triggerRemaining: def.triggerLimit ?? null,
    generated: false,
    faceUp: false,
    ...overrides,
  }
}

function finishReveal(game) {
  let state = game
  while (state.phase === 'reveal') state = revealStep(state)
  return state
}

describe('卡组、随机与构筑', () => {
  it('双方以 30 张卡组开始，同 seed 重放结果一致', () => {
    const game = createGame({ seed: 'base-seed', firstPlayer: 'user' })
    expect(game.decks.user).toHaveLength(25)
    expect(game.decks.ai).toHaveLength(25)
    expect(game.hands.user).toHaveLength(5)
    expect(game.hands.ai).toHaveLength(5)
    expect(game.firstPlayer).toBe('user')
    expect(game.seed).toBe('base-seed')

    const first = createGame({ seed: 'repeat-seed', userRecipe: DEFAULT_RECIPE, aiRecipe: DEFAULT_RECIPE })
    const second = createGame({ seed: 'repeat-seed', userRecipe: DEFAULT_RECIPE, aiRecipe: DEFAULT_RECIPE })
    expect(first.firstPlayer).toBe(second.firstPlayer)
    expect(first.dimensions).toEqual(second.dimensions)
    expect(first.decks.user.map((card) => card.cardId)).toEqual(second.decks.user.map((card) => card.cardId))
    expect(first.decks.ai.map((card) => card.cardId)).toEqual(second.decks.ai.map((card) => card.cardId))
    expect(first.hands.user.map((card) => card.cardId)).toEqual(second.hands.user.map((card) => card.cardId))
    expect(first.rngState).toBe(second.rngState)
  })

  it('第一回合先手由 seed 随机决定', () => {
    const outcomes = Array.from({ length: 24 }, (_, index) => createGame({ seed: `first-${index}` }).firstPlayer)
    expect(new Set(outcomes)).toEqual(new Set(['user', 'ai']))
  })

  it('卡组大小、同名、等级与系统卡限制仍然生效', () => {
    expect(validateDeckRecipe([['A11.1', 29]]).valid).toBe(false)
    expect(validateDeckRecipe(DEFAULT_RECIPE).valid).toBe(true)
    expect(validateDeckRecipe([['A11.1', 41]]).valid).toBe(false)
    expect(validateDeckRecipe([['A11.1', 4]]).errors).toContain('「列鼎」同名至多3张')
    expect(validateDeckRecipe([['A11.3', 13]]).errors).toContain('灾祸级合计至多12张')
    expect(validateDeckRecipe([['A11.4', 3], ['B11.4', 3], ['C11.4', 2]]).errors).toContain('崩坏级合计至多7张')
    expect(validateDeckRecipe([['A11.5', 3], ['B11.5', 1]]).errors).toContain('终末级合计至多3张')
    expect(validateDeckRecipe([['O1000', 30]]).valid).toBe(false)
  })

  it('隐秘级不再有独立携带上限', () => {
    expect(LEVEL_DECK_LIMITS['隐秘']).toBeUndefined()
    const recipe = [
      ['Y12', 3],
      ['A11.1', 3], ['A11.2', 3], ['B11.1', 3], ['B11.2', 3], ['C11.1', 3], ['C11.2', 3],
      ['A11.3', 3], ['B11.3', 3], ['C11.3', 3],
      ['A11.4', 1],
    ]
    expect(validateDeckRecipe(recipe).valid).toBe(true)
  })

  it('系列倾向随机配方符合 0.12 构筑规则', () => {
    for (const tendency of ['均衡', 'A', 'B', 'C', 'O', 'Y']) {
      const recipe = buildRandomDeckRecipe({ tendency, rng: () => 0 })
      const result = validateDeckRecipe(recipe)
      expect(result.valid).toBe(true)
      expect(result.total).toBeGreaterThanOrEqual(30)
      expect(result.total).toBeLessThanOrEqual(40)
      expect(result.levelCounts['灾祸'] || 0).toBeLessThanOrEqual(12)
      expect(result.levelCounts['崩坏'] || 0).toBeLessThanOrEqual(7)
      expect(result.levelCounts['终末'] || 0).toBeLessThanOrEqual(3)
    }
  })
})

describe('出牌、跳过与停止', () => {
  it('按回合开放等级，并限制中枢与边界位置', () => {
    expect(canPlay(makeCard('A14'), 3, 3)).toBe(false)
    expect(canPlay(makeCard('A14'), 3, 4)).toBe(true)
    expect(canPlay(makeCard('A11.5'), 1, 6)).toBe(false)
    expect(canPlay(makeCard('A11.5'), 1, 7)).toBe(true)
    expect(canPlay(makeCard('O1000'), 3, 7)).toBe(false)
    expect(canPlay(makeCard('Y96'), 1, 1)).toBe(false)
    expect(canPlay(makeCard('Y96'), 6, 4)).toBe(true)
  })

  it('跳过当前位置后，本回合仍可返回放置', () => {
    let game = createGame({ seed: 'skip-return', firstPlayer: 'user' })
    const target = game.hands.user.find((card) => canPlay(card, 3, game.round))
    game = selectSlot(game, 3)
    game = skipSlot(game)
    expect(game.turn.player).toBe('user')
    expect(game.board[2]).toBeNull()
    game = selectSlot(game, 3)
    game = placeCard(game, target.uid)
    expect(game.board[2]?.uid).toBe(target.uid)
  })

  it('停止出牌后不能返回已跳过的位置', () => {
    let game = createGame({ seed: 'stop-no-return', firstPlayer: 'user' })
    const target = game.hands.user[0]
    game = stopTurn(game)
    expect(game.turn.player).toBe('ai')
    const attempted = placeCard(game, target.uid)
    expect(attempted.board.filter((card) => card?.owner === 'user')).toHaveLength(0)
    expect(attempted.turn.player).toBe('ai')
  })

  it('跳过1号位不会立刻生成存在，结束出牌时才生成', () => {
    let game = createGame({ seed: 'skip-main', firstPlayer: 'user' })
    game.hands.user = []
    game = skipSlot(game)
    expect(game.board[0]).toBeNull()
    game = stopTurn(game)
    expect(game.board[0]?.cardId).toBe('O1000')
  })

  it('放满自己的三个位置后自动交给对手', () => {
    let game = createGame({ seed: 'auto-handover', firstPlayer: 'user' })
    game.hands.user = [makeCard('A11.1'), makeCard('A11.2'), makeCard('B11.1')]
    game = placeCard(game, game.hands.user[0].uid)
    game = placeCard(game, game.hands.user[0].uid)
    game = placeCard(game, game.hands.user[0].uid)
    expect(game.turn.player).toBe('ai')
    expect(game.board.filter(Boolean)).toHaveLength(3)
  })
})

describe('四维、修正与结算随机', () => {
  it('使用先手3、5号与后手2、4、6号计分', () => {
    const game = createGame({ seed: 'score', firstPlayer: 'user' })
    game.dimensions = ['chaos', 'barren']
    game.board = Array(6).fill(null)
    game.board[0] = makeCard('O11', { faceUp: true })
    game.board[2] = makeCard('O11', { faceUp: true, stats: { chaos: 3, barren: 1, disqualification: 0, calamity: 0 } })
    game.board[4] = makeCard('O11', { faceUp: true, stats: { chaos: 1, barren: 2, disqualification: 0, calamity: 0 } })
    game.board[1] = makeCard('O11', { faceUp: true, stats: { chaos: 2, barren: 1, disqualification: 0, calamity: 0 } })
    game.board[3] = makeCard('O11', { faceUp: true, stats: { chaos: 2, barren: 1, disqualification: 0, calamity: 0 } })
    game.board[5] = makeCard('O11', { faceUp: true, stats: { chaos: 2, barren: 1, disqualification: 0, calamity: 0 } })
    const result = calculateScores(game, () => 0.5)
    expect(result.firstScore).toBe(14)
    expect(result.secondScore).toBe(18)
    expect(result.userScore).toBe(14)
  })

  it('临时修正允许超过6或低于0，小数统一向下取整', () => {
    const game = createGame({ seed: 'overflow', firstPlayer: 'user' })
    game.dimensions = ['chaos']
    game.board = Array(6).fill(null)
    const main = makeCard('O11', { faceUp: true, stats: { chaos: 6, barren: 0, disqualification: 0, calamity: 0 }, tempStats: { chaos: 5 } })
    game.board[0] = main
    game.board[2] = makeCard('O11', { faceUp: true, stats: { chaos: 3, barren: 0, disqualification: 0, calamity: 0 } })
    expect(effectiveStats(main).chaos).toBe(11)
    expect(calculateScores(game, () => 0).firstScore).toBe(33)
    main.tempStats.chaos = -20
    expect(effectiveStats(main).chaos).toBe(-14)
    expect(calculateScores(game, () => 0).firstScore).toBe(0)
    main.tempStats.chaos = 1.9
    expect(effectiveStats(main).chaos).toBe(7)
  })

  it('问号在结算阶段随机，不覆盖牌面，且下次重新随机', () => {
    const game = createGame({ seed: 'question', firstPlayer: 'user' })
    game.dimensions = ['chaos']
    game.board = Array(6).fill(null)
    game.board[0] = makeCard('O11', { faceUp: true, stats: { chaos: '?', barren: 0, disqualification: 0, calamity: 0 } })
    game.board[2] = makeCard('O11', { faceUp: true, stats: { chaos: 3, barren: 0, disqualification: 0, calamity: 0 } })
    expect(calculateScores(game, () => 0).firstScore).toBe(3)
    expect(calculateScores(game, () => 0.999).firstScore).toBe(18)
    expect(game.board[0].stats.chaos).toBe('?')
  })

  it('问号随机不受非光环修正影响，但会接受光环修正', () => {
    const game = createGame({ seed: 'question-mods', firstPlayer: 'user' })
    game.dimensions = ['chaos']
    game.board = Array(6).fill(null)
    game.board[0] = makeCard('O11', {
      faceUp: true,
      stats: { chaos: '?', barren: 0, disqualification: 0, calamity: 0 },
      tempStats: { chaos: -100 },
    })
    game.mounts.user = { id: 'C5', owner: 'user', chargesRemaining: null, faceUp: true }
    game.board[2] = makeCard('O11', { faceUp: true, stats: { chaos: 3, barren: 0, disqualification: 0, calamity: 0 } })
    expect(calculateScores(game, () => 0).firstScore).toBe(8)
  })
})

describe('显现触发模型', () => {
  it('每次由暗转明都会重复触发显现', () => {
    patchCard('O11', { trigger: '显现', triggerVariant: null, triggerLimit: undefined, effect: 'antNest' })
    let game = createGame({ seed: 'repeat-reveal', firstPlayer: 'user' })
    game.board[0] = makeCard('O11', { faceUp: true })
    game.board[1] = makeCard('O11', { owner: 'ai' })
    game.phase = 'reveal'
    game.revealQueue = [2]
    game.revealIndex = 0
    game = revealStep(game)
    expect(effectiveStats(game.board[0]).barren).toBe(4)
    game.board[1].faceUp = false
    game.revealQueue = [2]
    game.revealIndex = 0
    game = revealStep(game)
    expect(effectiveStats(game.board[0]).barren).toBe(6)
  })

  it('显现限制n按卡牌实例递减，到0后不再触发', () => {
    patchCard('O11', { trigger: '显现', triggerVariant: null, triggerLimit: 2, effect: 'antNest' })
    let game = createGame({ seed: 'limited-reveal', firstPlayer: 'user' })
    game.board[0] = makeCard('O11', { faceUp: true })
    game.board[1] = makeCard('O11', { owner: 'ai' })
    game.phase = 'reveal'
    game.revealQueue = [2]
    game.revealIndex = 0
    game = revealStep(game)
    expect(game.board[1].triggerRemaining).toBe(1)
    expect(effectiveStats(game.board[0]).barren).toBe(4)
    game.board[1].faceUp = false
    game.revealQueue = [2]
    game.revealIndex = 0
    game = revealStep(game)
    expect(game.board[1].triggerRemaining).toBe(0)
    expect(effectiveStats(game.board[0]).barren).toBe(6)
    game.board[1].faceUp = false
    game.revealQueue = [2]
    game.revealIndex = 0
    game = revealStep(game)
    expect(game.board[1].triggerRemaining).toBe(0)
    expect(effectiveStats(game.board[0]).barren).toBe(6)
  })

  it('镜子复制相邻前位当前四维', () => {
    let game = createGame({ seed: 'mirror', firstPlayer: 'user' })
    game.board = Array(6).fill(null)
    game.board[0] = makeCard('O11', { faceUp: true, stats: { chaos: 5, barren: 4, disqualification: 3, calamity: 2 } })
    game.board[1] = makeCard('Y12')
    game.phase = 'reveal'
    game.revealQueue = [2]
    game.revealIndex = 0
    game = revealStep(game)
    expect(game.board[1].stats).toEqual({ chaos: 5, barren: 4, disqualification: 3, calamity: 2 })
    game = finishReveal(game)
    expect(game.phase).toBe('retain')
  })

  it('手牌满8时，椛不能向对手手牌生成复制', () => {
    let game = createGame({ seed: 'bloom-limit', firstPlayer: 'user' })
    game.board = Array(6).fill(null)
    game.board[1] = makeCard('C31', { owner: 'ai' })
    game.hands.user = Array.from({ length: 8 }, (_, index) => makeCard('O11', { uid: `full-${index}` }))
    game.phase = 'reveal'
    game.revealQueue = [2]
    game.revealIndex = 0
    game = revealStep(game)
    expect(game.hands.user).toHaveLength(8)
  })
})

describe('回合流程、保留与胜负', () => {
  it('拼点完成后先进入弃牌与保留，保留完成后才结算', () => {
    let game = createGame({ seed: 'phase-order', firstPlayer: 'user' })
    game.board[0] = makeCard('O11', { faceUp: true })
    game.phase = 'reveal'
    game.revealQueue = []
    game.revealIndex = 0
    game = revealStep(game)
    expect(game.phase).toBe('retain')
    expect(game.roundResult).toBeNull()
    expect(game.board[0]).not.toBeNull()
    const resolved = completeRound(game, null)
    expect(resolved.roundResult).toBeTruthy()
    expect(resolved.board.every((card) => card === null)).toBe(true)
    expect(resolved.phase).toBe('roundEnd')
  })

  it('可以连续完成三个回合并严格交替先手', () => {
    let game = createGame({ seed: 'continuous', firstPlayer: 'user' })
    for (let round = 0; round < 3; round += 1) {
      game.phase = 'reveal'
      game.revealQueue = []
      game.revealIndex = 0
      game = revealStep(game)
      game = completeRound(game, null)
      expect(game.roundResult).toBeTruthy()
      game = beginNextRound(game)
    }
    expect(game.round).toBe(4)
    expect(game.firstPlayer).toBe('ai')
    expect(game.hands.user.length).toBeLessThanOrEqual(5)
    expect(game.hands.ai.length).toBeLessThanOrEqual(5)
  })

  it('蜂巢保留后混沌永久加一', () => {
    let game = createGame({ seed: 'hive', firstPlayer: 'user' })
    game.phase = 'retain'
    const hive = makeCard('B19')
    game.hands.user = [hive]
    game.hands.ai = []
    game.board = Array(6).fill(null)
    const next = completeRound(game, hive.uid)
    const retained = next.hands.user.find((card) => card.uid === hive.uid)
    expect(retained.permanentStats.chaos).toBe(1)
    expect(effectiveStats(retained).chaos).toBe(5)
  })

  it('被保留牌的非永久修正会在下1个回合结束时清除', () => {
    let game = createGame({ seed: 'retain-temp', firstPlayer: 'user' })
    game.phase = 'retain'
    const retained = makeCard('O11', { tempStats: { chaos: 5 } })
    const uid = retained.uid
    game.hands.user = [retained]
    game.hands.ai = []
    game.board = Array(6).fill(null)
    let next = completeRound(game, uid)
    const kept = next.hands.user.find((card) => card.uid === uid)
    expect(effectiveStats(kept).chaos).toBe(7)
    next = beginNextRound(next)
    next.phase = 'retain'
    next.board = Array(6).fill(null)
    next.hands.ai = []
    const resolved = completeRound(next, uid)
    const cleared = resolved.hands.user.find((card) => card.uid === uid)
    expect(effectiveStats(cleared).chaos).toBe(2)
  })

  it('双方同时达到5胜后，领先者立即获胜', () => {
    let game = createGame({ seed: 'overtime', firstPlayer: 'user' })
    game.round = 5
    game.wins = { user: 5, ai: 5 }
    game.dimensions = ['chaos']
    game.board = Array(6).fill(null)
    game.board[0] = makeCard('O11', { faceUp: true, stats: { chaos: 2, barren: 0, disqualification: 0, calamity: 0 } })
    game.board[2] = makeCard('O11', { faceUp: true, stats: { chaos: 3, barren: 0, disqualification: 0, calamity: 0 } })
    game.phase = 'retain'
    game.hands.user = []
    game.hands.ai = []
    const next = completeRound(game, null)
    expect(next.gameWinner).toBe('user')
    expect(next.phase).toBe('gameOver')
  })

  it('第9回合结束后仍不分胜负则平局', () => {
    let game = createGame({ seed: 'draw-game', firstPlayer: 'user' })
    game.round = 9
    game.wins = { user: 4, ai: 4 }
    game.phase = 'retain'
    game.board = Array(6).fill(null)
    game.hands.user = []
    game.hands.ai = []
    const next = completeRound(game, null)
    expect(next.gameWinner).toBe('draw')
    expect(next.phase).toBe('gameOver')
  })
})

describe('弃置、区域上限与展示顺序', () => {
  it('手牌进入弃牌区时触发弃置', () => {
    patchCard('O11', { trigger: '弃置', effect: 'discardProbe' })
    let game = createGame({ seed: 'discard-trigger', firstPlayer: 'user' })
    game.phase = 'retain'
    game.hands.user = [makeCard('O11')]
    game.hands.ai = []
    game.board = Array(6).fill(null)
    const next = completeRound(game, null)
    expect(next.logs.some((log) => log.text.includes('触发［弃置］'))).toBe(true)
  })

  it('放逐卡牌被弃置时不触发弃置', () => {
    patchCard('O11', { trigger: '弃置', effect: 'discardProbe' })
    let game = createGame({ seed: 'exile-discard', firstPlayer: 'user' })
    game.phase = 'retain'
    game.hands.user = [makeCard('O11', { keywords: ['放逐'] })]
    game.hands.ai = []
    game.board = Array(6).fill(null)
    const next = completeRound(game, null)
    expect(next.exiles.user).toHaveLength(1)
    expect(next.logs.some((log) => log.text.includes('触发［弃置］'))).toBe(false)
  })

  it('弃牌区满60后溢出的牌移出游戏且不触发弃置', () => {
    patchCard('O11', { trigger: '弃置', effect: 'discardProbe' })
    let game = createGame({ seed: 'discard-overflow', firstPlayer: 'user' })
    game.phase = 'retain'
    game.discards.user = Array.from({ length: DISCARD_LIMIT }, (_, index) => makeCard('O11', { uid: `discard-${index}` }))
    game.hands.user = [makeCard('O11')]
    game.hands.ai = []
    game.board = Array(6).fill(null)
    const next = completeRound(game, null)
    expect(next.discards.user).toHaveLength(DISCARD_LIMIT)
    expect(next.removedCards.user).toHaveLength(1)
    expect(next.logs.filter((log) => log.text.includes('触发［弃置］'))).toHaveLength(0)
  })

  it('牌库达到60后不能再生成或加入卡牌', () => {
    const game = createGame({ seed: 'deck-limit', firstPlayer: 'user' })
    game.decks.user = Array.from({ length: 60 }, (_, index) => makeCard('O11', { uid: `deck-${index}` }))
    expect(addCardToDeck(game, 'user', makeCard('O11'))).toBe(false)
    expect(game.decks.user).toHaveLength(60)
  })

  it('牌库与弃牌区按固定等级顺序展示，不显示真实顺序', () => {
    const cards = [
      makeCard('A11.1', { uid: 'pure' }),
      makeCard('A11.2', { uid: 'sprout' }),
      makeCard('A11.3', { uid: 'calamity' }),
      makeCard('A11.4', { uid: 'collapse' }),
      makeCard('A11.5', { uid: 'final' }),
      makeCard('Y12', { uid: 'hidden' }),
    ]
    expect(sortCardsForDisplay(cards).map((card) => card.uid)).toEqual([
      'final', 'collapse', 'calamity', 'sprout', 'pure', 'hidden',
    ])
  })
})

describe('系统备用主世界', () => {
  it('先手无法出牌时生成存在，双方空里世界时双方获得0分', () => {
    let game = createGame({ seed: 'existence', firstPlayer: 'user' })
    game.dimensions = ['chaos', 'barren']
    game.hands.user = []
    game = stopTurn(game)
    expect(game.board[0].cardId).toBe('O1000')
    expect(game.board[0].owner).toBe('system')
    expect(game.board[0].generated).toBe(true)
    expect(game.board[0].faceUp).toBe(true)
    expect(game.hands.user).toHaveLength(0)
    game = stopTurn(game)
    game = finishReveal(game)
    expect(game.phase).toBe('retain')
    const resolved = completeRound(game, null)
    expect(resolved.roundResult.firstScore).toBe(0)
    expect(resolved.roundResult.secondScore).toBe(0)
    expect(resolved.wins.user).toBe(1)
    expect(resolved.wins.ai).toBe(1)
  })

  it('先手已有主世界时不生成存在', () => {
    let game = createGame({ seed: 'existing-main', firstPlayer: 'user' })
    const playable = game.hands.user.find((item) => canPlay(item, 1, game.round))
    game = placeCard(game, playable.uid)
    const mainUid = game.board[0].uid
    game = stopTurn(game)
    expect(game.board[0].uid).toBe(mainUid)
    expect(game.board[0].cardId).not.toBe('O1000')
    expect(game.board.filter((item) => item?.cardId === 'O1000')).toHaveLength(0)
  })

  it('存在进入系统放逐区并在下次生成时恢复原始值', () => {
    let game = createGame({ seed: 'existence-restore', firstPlayer: 'user' })
    game = stopTurn(game)
    const firstUid = game.board[0].uid
    game.board[0].stats.chaos = 6
    game.phase = 'retain'
    game = completeRound(game, null)
    expect(game.exiles.system).toHaveLength(1)
    expect(game.exiles.system[0].uid).toBe(firstUid)
    for (const player of ['user', 'ai']) {
      const cards = [...game.hands[player], ...game.decks[player], ...game.discards[player], ...game.exiles[player]]
      expect(cards.filter((item) => item.cardId === 'O1000')).toHaveLength(0)
    }
    game = beginNextRound(game)
    game.hands.user = []
    game = stopTurn(game)
    expect(game.board[0].uid).not.toBe(firstUid)
    expect(game.board[0].stats).toEqual({ chaos: 1, barren: 1, disqualification: 1, calamity: 1 })
  })
})
