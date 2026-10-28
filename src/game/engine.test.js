import { describe, expect, it } from 'vitest'
import {
  ANCHOR, CARD_MAP, calculateScores, canPlay, completeRound, createGame, openRetention,
  revealStep,
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
  it('先手每个维度获得锚定值 3', () => {
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
    expect(ANCHOR).toBe(3)
    expect(result.firstScore).toBe(26)
    expect(result.secondScore).toBe(18)
    expect(result.userScore).toBe(26)
  })

  it('空天将空无视为 2，并启用全部四维', () => {
    const game = createGame()
    game.board = Array(6).fill(null)
    game.board[0] = card('C1', { faceUp: true })
    const result = calculateScores(game)
    expect(result.dimensions).toHaveLength(4)
    expect(result.firstScore).toBe(24)
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
