import { describe, expect, it } from 'vitest'
import {
  CARD_MAP, DEFAULT_RECIPE, buildRandomDeckRecipe, calculateScores, canPlay, completeRound,
  createGame, openRetention, placeCard, revealStep, stopTurn, validateDeckRecipe,
} from './engine'

function card(id, overrides = {}) {
  return {
    uid: overrides.uid || `${id}-${Math.random()}`,
    cardId: id,
    owner: overrides.owner || 'user',
    stats: { ...CARD_MAP[id].stats },
    keywords: [...CARD_MAP[id].keywords],
    tempStats: {},
    generated: false,
    faceUp: false,
    hasRevealed: false,
    ...overrides,
  }
}

describe('卡组与回合基础', () => {
  it('双方以 30 张牌库和 5 张手牌开始', () => {
    const game = createGame()
    expect(game.decks.user).toHaveLength(25)
    expect(game.decks.ai).toHaveLength(25)
    expect(game.hands.user).toHaveLength(5)
    expect(game.hands.ai).toHaveLength(5)
    expect(game.firstPlayer).toBe('user')
  })

  it('按回合开放崩坏与终末，并限制中枢和边界', () => {
    expect(canPlay(card('A4'), 3, 3)).toBe(false)
    expect(canPlay(card('A4'), 3, 4)).toBe(true)
    expect(canPlay(card('C1'), 1, 6)).toBe(false)
    expect(canPlay(card('C1'), 1, 7)).toBe(true)
    expect(canPlay(card('C1'), 3, 7)).toBe(false)
    expect(canPlay(card('Y96'), 1, 1)).toBe(false)
    expect(canPlay(card('Y96'), 6, 4)).toBe(true)
  })
})

describe('计分公式', () => {
  it('先手只计算三号位与五号位的维度值', () => {
    const game = createGame()
    game.dimensions = ['chaos', 'barren']
    game.board = Array(6).fill(null)
    game.board[0] = card('O1', { faceUp: true })
    game.board[2] = card('O1', { faceUp: true, stats: { chaos: 3, barren: 1, disqualification: 0, calamity: 0 } })
    game.board[4] = card('O1', { faceUp: true, stats: { chaos: 1, barren: 2, disqualification: 0, calamity: 0 } })
    game.board[1] = card('O1', { faceUp: true, stats: { chaos: 2, barren: 1, disqualification: 0, calamity: 0 } })
    game.board[3] = card('O1', { faceUp: true, stats: { chaos: 2, barren: 1, disqualification: 0, calamity: 0 } })
    game.board[5] = card('O1', { faceUp: true, stats: { chaos: 2, barren: 1, disqualification: 0, calamity: 0 } })
    const result = calculateScores(game)
    expect(result.firstScore).toBe(14)
    expect(result.secondScore).toBe(18)
    expect(result.userScore).toBe(14)
  })

  it('空天将空无视为 2，并启用全部四维', () => {
    const game = createGame()
    game.board = Array(6).fill(null)
    game.board[0] = card('C1', { faceUp: true })
    const result = calculateScores(game)
    expect(result.dimensions).toHaveLength(4)
    expect(result.firstScore).toBe(0)
    expect(result.secondScore).toBe(0)
  })
})

describe('卡牌效果', () => {
  it('镜子复制相邻前位的当前四维', () => {
    const game = createGame()
    game.board = Array(6).fill(null)
    game.board[0] = card('O1', { faceUp: true, hasRevealed: true, stats: { chaos: 5, barren: 4, disqualification: 3, calamity: 2 } })
    game.board[1] = card('Y2')
    game.phase = 'reveal'
    game.revealQueue = [2]
    game.revealIndex = 0
    const revealed = revealStep(game)
    expect(revealed.board[1].stats).toEqual({ chaos: 5, barren: 4, disqualification: 3, calamity: 2 })
    const next = revealStep(revealed)
    expect(next.phase).toBe('roundEnd')
  })

  it('椛在对手手牌生成可放逐复制', () => {
    const game = createGame()
    game.board = Array(6).fill(null)
    game.board[1] = card('C31', { owner: 'ai' })
    game.phase = 'reveal'
    game.revealQueue = [2]
    game.revealIndex = 0
    const before = game.hands.user.length
    const next = revealStep(game)
    expect(next.hands.user).toHaveLength(before + 1)
    expect(next.hands.user.at(-1).generated).toBe(true)
    expect(next.hands.user.at(-1).keywords).toContain('放逐')
  })

  it('保留蜂巢时混沌加一，且下一回合交替先手', () => {
    const game = createGame()
    game.phase = 'retain'
    game.hands.user = [card('B9')]
    game.hands.ai = []
    game.board = Array(6).fill(null)
    const next = completeRound(game, game.hands.user[0].uid)
    const hive = next.hands.user.find((item) => item.cardId === 'B9')
    expect(hive.stats.chaos).toBe(5)
    expect(next.round).toBe(2)
    expect(next.firstPlayer).toBe('ai')
  })
})

describe('连续回合', () => {
  it('可以在玩家停止出牌后连续完成三个回合并循环牌库', () => {
    let game = createGame()
    for (let round = 0; round < 3; round += 1) {
      game.phase = 'reveal'
      game.revealQueue = []
      game.revealIndex = 0
      game = revealStep(game)
      expect(game.roundResult).toBeTruthy()
      game = openRetention(game)
      game = completeRound(game, null)
    }
    expect(game.round).toBe(4)
    expect(game.hands.user.length).toBeLessThanOrEqual(5)
    expect(game.hands.ai.length).toBeLessThanOrEqual(5)
  })
})

describe('系统备用主世界', () => {
  it('先手无法出牌时生成存在，双方空里世界时双方获得 0 分', () => {
    let game = createGame()
    game.dimensions = ['chaos', 'barren']
    game.hands.user = []
    game = stopTurn(game)
    expect(game.board[0].cardId).toBe('O1000')
    expect(game.board[0].owner).toBe('system')
    expect(game.board[0].generated).toBe(true)
    expect(game.board[0].faceUp).toBe(true)
    expect(game.hands.user).toHaveLength(0)
    game = stopTurn(game)
    game = revealStep(game)
    expect(game.phase).toBe('roundEnd')
    expect(game.roundResult.firstScore).toBe(0)
    expect(game.roundResult.secondScore).toBe(0)
    expect(game.wins.user).toBe(1)
    expect(game.wins.ai).toBe(1)
  })

  it('先手已有主世界时不生成存在', () => {
    let game = createGame()
    const playable = game.hands.user.find((item) => canPlay(item, 1, game.round))
    game = placeCard(game, playable.uid)
    const mainUid = game.board[0].uid
    game = stopTurn(game)
    expect(game.board[0].uid).toBe(mainUid)
    expect(game.board[0].cardId).not.toBe('O1000')
    expect(game.board.filter((item) => item?.cardId === 'O1000')).toHaveLength(0)
  })

  it('存在进入系统放逐区并在下次生成时恢复原始值', () => {
    let game = createGame()
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
    game = stopTurn(game)
    expect(game.board[0].uid).not.toBe(firstUid)
    expect(game.board[0].stats).toEqual({ chaos: 1, barren: 1, disqualification: 1, calamity: 1 })
  })
})

describe('卡组构筑规则', () => {
  const whiteboardRecipe = DEFAULT_RECIPE

  it('卡组必须为 30 至 40 张', () => {
    expect(validateDeckRecipe([['A1.1', 29]]).valid).toBe(false)
    expect(validateDeckRecipe(whiteboardRecipe).valid).toBe(true)
    expect(validateDeckRecipe([['A1.1', 41]]).valid).toBe(false)
  })

  it('限制同名卡与灾祸、崩坏、终末数量', () => {
    expect(validateDeckRecipe([['A1.1', 4]]).errors).toContain('「列鼎」同名至多3张')
    expect(validateDeckRecipe([['A1.3', 13]]).errors).toContain('灾祸级合计至多12张')
    expect(validateDeckRecipe([['A1.4', 3], ['B1.4', 3], ['C1.4', 2]]).errors).toContain('崩坏级合计至多7张')
    expect(validateDeckRecipe([['A1.5', 3], ['B1.5', 1]]).errors).toContain('终末级合计至多3张')
  })

  it('系统备用卡与未知卡不能进入卡组', () => {
    expect(validateDeckRecipe([['O1000', 30]]).valid).toBe(false)
    expect(validateDeckRecipe([['X999', 30]]).errors).toContain('未知卡牌：X999')
  })

  it('各系列倾向的随机配方均符合构筑规则', () => {
    for (const tendency of ['均衡', 'A', 'B', 'C', 'O', 'Y']) {
      const recipe = buildRandomDeckRecipe({ tendency, rng: () => 0 })
      const result = validateDeckRecipe(recipe)
      expect(result.valid).toBe(true)
      expect(result.total).toBeGreaterThanOrEqual(30)
      expect(result.total).toBeLessThanOrEqual(40)
      expect(result.levelCounts['灾祸'] || 0).toBeLessThanOrEqual(12)
      expect(result.levelCounts['崩坏'] || 0).toBeLessThanOrEqual(7)
      expect(result.levelCounts['终末'] || 0).toBeLessThanOrEqual(3)
      expect(result.levelCounts['隐秘'] || 0).toBeLessThanOrEqual(6)
    }
  })

  it('可以使用自定义配方创建对局', () => {
    const userRecipe = [...whiteboardRecipe, ['B1.1', 1], ['C1.1', 1], ['C1.2', 1]]
    const game = createGame({ userRecipe })
    expect(validateDeckRecipe(userRecipe).valid).toBe(true)
    expect(game.decks.user).toHaveLength(28)
    expect(game.hands.user).toHaveLength(5)
    expect(game.decks.ai).toHaveLength(25)
  })
})
