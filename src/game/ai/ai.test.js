import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CARD_MAP, revealStep } from '../engine'
import {
  AIConfig,
  AI_DIFFICULTIES,
  AITimeoutError,
  BeginnerPolicy,
  HardPolicy,
  LegalActions,
  RegularPolicy,
  RulesEngine,
  calculateHardX,
  chooseAction,
  chooseHardAction,
  compareResourceCost,
  createAIRng,
  enumerateAssignments,
  evaluateState,
  evaluateTerminalState,
  expectedValueOverHumanResponses,
  getAcceptFloor,
  getBestScoringAssignment,
  getHardCandidateActions,
  getHardInformationView,
  getLegalCards,
  slotScore,
  step,
} from './index'
import { chooseKeepByPriority } from './keep'
import { fillWithLowestValueCards } from './regular'

function makeCard(id, overrides = {}) {
  const def = CARD_MAP[id]
  const { stats, ...rest } = overrides
  return {
    uid: overrides.uid || `${id}-${Math.random().toString(36).slice(2)}`,
    cardId: id,
    owner: 'user',
    stats: { ...def.stats, ...stats },
    keywords: [...def.keywords],
    permanentStats: {},
    tempStats: {},
    auraStats: {},
    tempExpiryRound: null,
    triggerRemaining: def.triggerLimit ?? null,
    generated: false,
    faceUp: false,
    ...rest,
  }
}

function minimalState({
  actor = 'ai',
  firstPlayer = 'user',
  round = 1,
  hand = [],
  board = Array(6).fill(null),
  decks = { user: [], ai: [] },
  wins = { user: 0, ai: 0 },
  phase = 'play',
  gameWinner = null,
} = {}) {
  return {
    seed: 'ai-test-seed',
    rngState: 7,
    round,
    wins: { ...wins },
    firstPlayer,
    phase,
    dimensions: ['chaos', 'barren'],
    turn: { player: actor, activeSlot: null, skippedSlots: [] },
    board,
    hands: { user: [], ai: [], [actor]: hand },
    decks: { user: [...(decks.user || [])], ai: [...(decks.ai || [])] },
    discards: { user: [], ai: [] },
    exiles: { user: [], ai: [], system: [] },
    removedCards: { user: [], ai: [], system: [] },
    signatureLoadouts: { user: [], ai: [] },
    signatureOptions: { user: [], ai: [] },
    signatureSelections: { user: null, ai: null },
    mounts: { user: null, ai: null },
    pilgrimageUsed: { user: false, ai: false },
    logs: [],
    revealQueue: [],
    revealIndex: 0,
    pendingScoreBoard: null,
    roundResult: null,
    gameWinner,
  }
}

function sourceText(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const AI_FILES = [
  './config.js',
  './rng.js',
  './legal.js',
  './sandbox.js',
  './beginner.js',
  './regular.js',
  './hard.js',
  './index.js',
]

describe('AI-00：配置、随机数与状态副本', () => {
  it('00-1 策略文件不出现 Math.random()', () => {
    for (const file of AI_FILES) {
      expect(sourceText(file)).not.toContain('Math.random')
    }
  })

  it('00-2 step 只操作副本，输入状态只读', () => {
    const card = makeCard('O11', { owner: 'ai' })
    const state = minimalState({
      actor: 'ai',
      firstPlayer: 'user',
      hand: [card],
      board: [makeCard('O11', { owner: 'user', faceUp: true }), null, null, null, null, null],
    })
    const before = JSON.stringify(state)
    const next = step(state, { actor: 'ai', assignments: { 2: card.uid } })
    expect(JSON.stringify(state)).toBe(before)
    expect(next.board[1]?.uid).toBe(card.uid)
  })

  it('00-3 FIRST_COMPENSATION 与三档配置分离', () => {
    expect(AIConfig.FIRST_COMPENSATION).toBeDefined()
    for (const difficulty of AI_DIFFICULTIES) {
      expect(AIConfig[difficulty]).not.toHaveProperty('FIRST_COMPENSATION')
    }
  })
})

describe('AI-01：合法动作与分配枚举', () => {
  it('01-1 第1回合等级过滤', () => {
    const pure = makeCard('A11.1', { owner: 'ai' })
    const collapse = makeCard('A14', { owner: 'ai' })
    const final = makeCard('A11.5', { owner: 'ai' })
    const state = minimalState({ actor: 'ai', firstPlayer: 'user', hand: [pure, collapse, final] })
    expect(getLegalCards(state, 'ai').map((card) => card.uid)).toEqual([pure.uid])
  })

  it('01-2 用尽型 5 张合法牌得到 60 个分配', () => {
    const hand = ['A11.1', 'B11.1', 'C11.1', 'O11', 'Y12'].map((id, index) => makeCard(id, { owner: 'ai', uid: `legal-${index}` }))
    const state = minimalState({ actor: 'ai', firstPlayer: 'user', hand })
    expect(enumerateAssignments(state, 'ai', false)).toHaveLength(60)
  })

  it('01-3 非用尽型按工程上限得到 120 个候选并覆盖 0～3 张放置', () => {
    const hand = ['A11.1', 'B11.1', 'C11.1', 'O11', 'Y12'].map((id, index) => makeCard(id, { owner: 'ai', uid: `empty-${index}` }))
    const state = minimalState({ actor: 'ai', firstPlayer: 'user', hand })
    const assignments = enumerateAssignments(state, 'ai', true)
    expect(assignments).toHaveLength(120)
    const placedCounts = new Set(assignments.map((assignment) => Object.keys(assignment).length))
    expect(placedCounts).toEqual(new Set([0, 1, 2, 3]))
    expect(assignments.some((assignment) => Object.keys(assignment).length === 0)).toBe(true)
  })
})

describe('AI-02：入门阶', () => {
  it('02-1 有牌可用时用尽放置', () => {
    const hand = ['A11.1', 'B11.1', 'C11.1'].map((id, index) => makeCard(id, { owner: 'ai', uid: `beginner-${index}` }))
    const state = minimalState({ actor: 'ai', firstPlayer: 'user', hand })
    const action = BeginnerPolicy(state, 'ai', AIConfig, createAIRng('beginner-test'))
    expect(Object.keys(action.assignments)).toHaveLength(3)
    expect(Object.values(action.assignments).sort()).toEqual(hand.map((card) => card.uid).sort())
  })

  it('02-2 入门阶保留恒为 null', () => {
    const hand = [makeCard('A11.1', { owner: 'ai' })]
    const state = minimalState({ actor: 'ai', firstPlayer: 'user', hand })
    expect(BeginnerPolicy(state, 'ai', AIConfig, createAIRng('keep')).keepPlan).toBeNull()
  })

  it('02-3 入门阶无智能估值依赖', () => {
    const text = sourceText('./beginner.js')
    for (const forbidden of ['slotScore', 'evaluateState', 'getBestScoringAssignment', 'predictResponses']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('02-4 同一种子出牌可复现', () => {
    const hand = ['A11.1', 'B11.1', 'C11.1', 'O11', 'Y12'].map((id, index) => makeCard(id, { owner: 'ai', uid: `seed-${index}` }))
    const state = minimalState({ actor: 'ai', firstPlayer: 'user', hand })
    const first = BeginnerPolicy(state, 'ai', AIConfig, createAIRng('same-seed'))
    const second = BeginnerPolicy(state, 'ai', AIConfig, createAIRng('same-seed'))
    expect(first.assignments).toEqual(second.assignments)
  })
})

describe('AI-03：常规阶最大得分 y', () => {
  it('03-1 单位置贡献为 14', () => {
    const main = makeCard('O11', { stats: { barren: 3, disqualification: 2 } })
    const card = makeCard('O11', { stats: { barren: 4, disqualification: 1 } })
    expect(slotScore(card, main, ['barren', 'disqualification'])).toBe(14)
  })

  it('03-2 先手枚举主世界而不是固定高总和牌', () => {
    const highTotal = makeCard('O11', { uid: 'high-total', owner: 'ai', stats: { chaos: 2, barren: 2, disqualification: 0, calamity: 0 } })
    const goodMain = makeCard('O11', { uid: 'good-main', owner: 'ai', stats: { chaos: 3, barren: 0, disqualification: 0, calamity: 0 } })
    const state = minimalState({ actor: 'ai', firstPlayer: 'ai', hand: [highTotal, goodMain], dimensions: ['chaos', 'barren'] })
    const best = getBestScoringAssignment(state, 'ai')
    expect(best.assignments[1]).toBe(goodMain.uid)
    expect(best.y).toBe(15)
  })

  it('03-3 4 张牌与独立暴力枚举一致', () => {
    const hand = [0, 1, 2, 3].map((index) => makeCard('O11', {
      owner: 'ai',
      uid: `brute-${index}`,
      stats: { chaos: index + 1, barren: 4 - index },
    }))
    const state = minimalState({ actor: 'ai', firstPlayer: 'ai', hand })
    const optimized = getBestScoringAssignment(state, 'ai').y
    let brute = Number.NEGATIVE_INFINITY
    for (let main = 0; main < hand.length; main += 1) {
      for (let three = 0; three < hand.length; three += 1) {
        if (three === main) continue
        for (let five = 0; five < hand.length; five += 1) {
          if (five === main || five === three) continue
          const y = slotScore(hand[main], hand[main], state.dimensions)
            + slotScore(hand[three], hand[main], state.dimensions)
            + slotScore(hand[five], hand[main], state.dimensions)
          brute = Math.max(brute, y)
        }
      }
    }
    expect(optimized).toBe(brute)
  })

  it('03-4 y 与 FIRST_COMPENSATION 隔离', () => {
    const hand = [makeCard('O11', { owner: 'ai', stats: { chaos: 5, barren: 0 } })]
    const state = minimalState({ actor: 'ai', firstPlayer: 'ai', hand })
    const configA = { ...AIConfig, FIRST_COMPENSATION: 0 }
    const configB = { ...AIConfig, FIRST_COMPENSATION: 99 }
    expect(getBestScoringAssignment(state, 'ai').y).toBe(RegularPolicy(state, 'ai', configA).debug.y)
    expect(RegularPolicy(state, 'ai', configA).debug.y).toBe(RegularPolicy(state, 'ai', configB).debug.y)
  })
})

describe('AI-04：常规阶分支与保留', () => {
  const singleCardState = () => minimalState({
    actor: 'ai',
    firstPlayer: 'ai',
    hand: [makeCard('O11', { owner: 'ai', stats: { chaos: 5, barren: 0 } })],
    dimensions: ['chaos', 'barren'],
  })

  it('04-1 y 等于底线走积极，低于底线走消极', () => {
    const activeConfig = { ...AIConfig, regular: { ...AIConfig.regular, FIRST_FLOOR: [25, 25, 25], SECOND_FLOOR: [25, 25, 25] } }
    const passiveConfig = { ...AIConfig, regular: { ...AIConfig.regular, FIRST_FLOOR: [26, 26, 26], SECOND_FLOOR: [26, 26, 26] } }
    const active = RegularPolicy(singleCardState(), 'ai', activeConfig)
    const passive = RegularPolicy(singleCardState(), 'ai', passiveConfig)
    expect(active.debug.passive).toBe(false)
    expect(passive.debug.passive).toBe(true)
  })

  it('04-2 消极分支仍按低价值用尽放置', () => {
    const low = makeCard('O11', { owner: 'ai', uid: 'low', stats: { chaos: 0, barren: 0, disqualification: 0, calamity: 0 } })
    const mid = makeCard('O11', { owner: 'ai', uid: 'mid', stats: { chaos: 1, barren: 1, disqualification: 1, calamity: 1 } })
    const high = makeCard('O11', { owner: 'ai', uid: 'high', stats: { chaos: 2, barren: 2, disqualification: 2, calamity: 2 } })
    const state = minimalState({ actor: 'ai', firstPlayer: 'ai', hand: [high, mid, low] })
    const assignments = fillWithLowestValueCards(state, 'ai')
    expect(Object.keys(assignments)).toHaveLength(3)
    expect(Object.values(assignments)).toEqual([low.uid, mid.uid, high.uid])
  })

  it('04-3 保留优先下回合合法而不是高总和', () => {
    const illegal = makeCard('A11.5', { owner: 'ai', uid: 'illegal', stats: { chaos: 6, barren: 6, disqualification: 6, calamity: 6 } })
    const legal = makeCard('A11.1', { owner: 'ai', uid: 'legal', stats: { chaos: 2, barren: 2, disqualification: 3, calamity: 3 } })
    expect(chooseKeepByPriority([illegal, legal], 4)?.uid).toBe('legal')
  })

  it('04-4 同级先比四维总和，再比层级', () => {
    const pure = makeCard('A11.1', { owner: 'ai', uid: 'pure', stats: { chaos: 1, barren: 1, disqualification: 1, calamity: 1 } })
    const sprout = makeCard('A11.2', { owner: 'ai', uid: 'sprout', stats: { chaos: 1, barren: 1, disqualification: 1, calamity: 1 } })
    expect(chooseKeepByPriority([pure, sprout], 1)?.uid).toBe('sprout')
  })
})

describe('AI-05：困难阶候选与透视视图', () => {
  it('05-1 复用非用尽枚举且候选为 120', () => {
    const hand = ['A11.1', 'B11.1', 'C11.1', 'O11', 'Y12'].map((id, index) => makeCard(id, { owner: 'ai', uid: `hard-${index}` }))
    const state = minimalState({ actor: 'ai', firstPlayer: 'user', hand })
    expect(getHardCandidateActions(state, 'ai')).toHaveLength(120)
  })

  it('05-2 先手视图只包含真人当前手牌', () => {
    const humanCard = makeCard('O11', { owner: 'user' })
    const state = minimalState({ actor: 'ai', firstPlayer: 'ai', hand: [makeCard('A11.1', { owner: 'ai' })] })
    state.hands.user.push(humanCard)
    const view = getHardInformationView(state, 'ai')
    expect(view.opponentHand.map((card) => card.uid)).toEqual([humanCard.uid])
    expect(view).not.toHaveProperty('opponentDeck')
    expect(view).not.toHaveProperty('futureDimensions')
  })

  it('05-3 后手视图读取真实暗牌引用值', () => {
    const dark = makeCard('O11', { owner: 'user', uid: 'dark-main', stats: { chaos: 3, barren: 1 } })
    const state = minimalState({ actor: 'ai', firstPlayer: 'user', board: [dark, null, null, null, null, null] })
    const view = getHardInformationView(state, 'ai')
    expect(view.opponentBoard[0].uid).toBe(dark.uid)
    expect(view.opponentBoard[0].stats.chaos).toBe(3)
  })

  it('05-4 信息视图没有额外透视字段', () => {
    const text = sourceText('./hard.js')
    const viewStart = text.indexOf('export function getHardInformationView')
    const viewEnd = text.indexOf('export function isTerminal')
    const viewSource = text.slice(viewStart, viewEnd)
    for (const forbidden of ['futureDimensions', 'nextDimensions', 'decks[opponent]', 'discards[opponent]']) {
      expect(viewSource).not.toContain(forbidden)
    }
  })
})

describe('AI-06：终局与估值接口', () => {
  it('06-1 胜、负、平局映射为 1、0、0.5', () => {
    const base = minimalState({ phase: 'gameOver' })
    expect(evaluateTerminalState({ ...base, gameWinner: 'ai' }, 'ai')).toBe(1)
    expect(evaluateTerminalState({ ...base, gameWinner: 'user' }, 'ai')).toBe(0)
    expect(evaluateTerminalState({ ...base, gameWinner: 'draw' }, 'ai')).toBe(0.5)
  })

  it('06-2 非终局估值必须在 [0,1]，越界报可诊断错误', () => {
    const state = minimalState({})
    expect(evaluateState(state, { actor: 'ai' })).toBeGreaterThanOrEqual(0)
    expect(evaluateState(state, { actor: 'ai' })).toBeLessThanOrEqual(1)
    expect(() => evaluateState(state, { actor: 'ai', evaluator: () => 1.2 })).toThrow(/Invalid V/)
  })

  it('06-3 HardPolicy 只依赖 evaluateState 接口', () => {
    const text = sourceText('./hard.js')
    expect(text).toContain('context.evaluator')
    expect(text).not.toContain('ColdStartModel.evaluate')
  })
})

describe('AI-07：真人响应期望 x', () => {
  it('07-1 按 0.2/0.8 概率加权得到 0.8', () => {
    const aiCard = makeCard('A11.1', { owner: 'ai' })
    const state = minimalState({ actor: 'ai', firstPlayer: 'ai', hand: [aiCard] })
    const humanModel = {
      predictResponses: () => [
        { assignment: {}, probability: 0.2, value: 0 },
        { assignment: {}, probability: 0.8, value: 1 },
      ],
    }
    const x = expectedValueOverHumanResponses(state, { 1: aiCard.uid }, humanModel, {
      actor: 'ai',
      view: getHardInformationView(state, 'ai'),
    })
    expect(x).toBe(0.8)
  })

  it('07-2 真人响应概率必须归一化且非负', () => {
    const aiCard = makeCard('A11.1', { owner: 'ai' })
    const state = minimalState({ actor: 'ai', firstPlayer: 'ai', hand: [aiCard] })
    const badModel = {
      predictResponses: () => [
        { assignment: {}, probability: 0.2, value: 0 },
        { assignment: {}, probability: 0.7, value: 1 },
      ],
    }
    expect(() => expectedValueOverHumanResponses(state, { 1: aiCard.uid }, badModel, { actor: 'ai' })).toThrow(/normalized/)
  })

  it('07-3/07-4 后手完整结算且不猜响应，无困难自对弈入口', () => {
    const text = sourceText('./hard.js')
    const secondBranch = text.slice(text.indexOf('const next = settleRound(state'))
    expect(secondBranch).not.toContain('expectedValueOverHumanResponses')
    expect(secondBranch).toContain('settleRound(state, { [actor]: assignment })')
    const allText = AI_FILES.map(sourceText).join('\n')
    expect(allText).not.toContain('runBatch')
    expect(allText).not.toContain('HardPolicy vs HardPolicy')
  })
})

describe('AI-08：a 分支与资源成本', () => {
  const state = minimalState({ actor: 'ai', firstPlayer: 'user', round: 3 })
  const actions = [{ assignments: {} }, { assignments: { 2: 'a' } }, { assignments: { 2: 'b', 4: 'c' } }]

  it('08-1 前中期选满足 a 的最低 x', () => {
    const chosen = chooseHardAction(actions, [0.2, 0.6, 0.8], state, { actor: 'ai', acceptFloor: 0.5 })
    expect(chosen.x).toBe(0.6)
    expect(chosen.passive).toBe(false)
  })

  it('08-2 后期选最高 x', () => {
    const lateState = minimalState({ actor: 'ai', firstPlayer: 'user', round: 7 })
    const chosen = chooseHardAction(actions, [0.2, 0.6, 0.8], lateState, { actor: 'ai', acceptFloor: 0.5 })
    expect(chosen.x).toBe(0.8)
  })

  it('08-3 xMax 低于 a 时进入消极分支', () => {
    const chosen = chooseHardAction(actions, [0.1, 0.3, 0.4], state, { actor: 'ai', acceptFloor: 0.5 })
    expect(chosen.passive).toBe(true)
    expect(chosen.xMax).toBe(0.4)
  })

  it('08-4 资源成本按层级、属性、放置数比较', () => {
    const low = makeCard('A11.1', { owner: 'ai', uid: 'cost-low', stats: { chaos: 1, barren: 0, disqualification: 0, calamity: 0 } })
    const high = makeCard('A11.2', { owner: 'ai', uid: 'cost-high', stats: { chaos: 1, barren: 0, disqualification: 0, calamity: 0 } })
    const costState = minimalState({ actor: 'ai', firstPlayer: 'user', hand: [low, high] })
    expect(compareResourceCost({ assignments: { 2: low.uid } }, { assignments: { 2: high.uid } }, costState))
      .toBeLessThan(0)
    expect(compareResourceCost({ assignments: {} }, { assignments: { 2: low.uid } }, costState))
      .toBeLessThan(0)
  })
})

describe('AI-09：时间预算与回退', () => {
  it('09-1 估值器首次超时返回常规阶动作并保留只读状态', () => {
    const hand = ['A11.1', 'B11.1', 'C11.1'].map((id, index) => makeCard(id, { owner: 'ai', uid: `timeout-${index}` }))
    const state = minimalState({ actor: 'ai', firstPlayer: 'ai', hand })
    const before = JSON.stringify(state)
    const result = HardPolicy(state, 'ai', AIConfig, createAIRng('timeout'), {
      humanModel: {
        predictResponses() {
          throw new AITimeoutError()
        },
      },
    })
    expect(JSON.stringify(state)).toBe(before)
    expect(result.debug.timeout).toBe(true)
    expect(result.debug.difficulty).toBe('hard')
    expect(Object.keys(result.assignments).length).toBeGreaterThan(0)
    expect(result.debug.y).not.toBeNull()
  })

  it('09-2/09-3 回退路径不为空且预算只影响 AI 调试信息', () => {
    const text = sourceText('./hard.js')
    expect(text).toContain('fallbackToRegular')
    expect(text).toContain('elapsedMs')
    const state = minimalState({ actor: 'ai', firstPlayer: 'user', hand: [] })
    const result = HardPolicy(state, 'ai', AIConfig, createAIRng('fallback'), { timeBudgetMs: 0 })
    expect(result.debug.timeout).toBe(true)
    expect(result.assignments).toEqual({})
  })
})

describe('AI-10：难度路由与日志', () => {
  it('10-1 三档难度分别路由，非法难度报错', () => {
    const empty = minimalState({ actor: 'ai', firstPlayer: 'user', hand: [] })
    expect(chooseAction(empty, 'ai', 'beginner', AIConfig, createAIRng('route')).debug.difficulty).toBe('beginner')
    expect(chooseAction(empty, 'ai', 'regular', AIConfig, createAIRng('route')).debug.difficulty).toBe('regular')
    expect(chooseAction(empty, 'ai', 'hard', AIConfig, createAIRng('route')).debug.difficulty).toBe('hard')
    expect(() => chooseAction(empty, 'ai', 'impossible', AIConfig, createAIRng('route'))).toThrow(/Unknown AI difficulty/)
  })

  it('10-2 难度选择不修改补偿、手牌、牌库或维度', () => {
    const text = sourceText('./index.js')
    const routing = text.slice(text.indexOf('export function chooseAction'), text.indexOf('export const RulesEngine'))
    expect(routing).not.toContain('FIRST_COMPENSATION')
    expect(routing).not.toContain('hands[')
    expect(routing).not.toContain('decks[')
    expect(routing).not.toContain('dimensions')
  })

  it('10-3 日志包含常规阶与困难阶复盘字段', () => {
    const regular = chooseAction(minimalState({ actor: 'ai', firstPlayer: 'user', hand: [] }), 'ai', 'regular', AIConfig, createAIRng('log'))
    expect(regular.debug).toHaveProperty('y')
    expect(regular.debug).toHaveProperty('floor')
    const hard = chooseAction(minimalState({ actor: 'ai', firstPlayer: 'user', hand: [] }), 'ai', 'hard', AIConfig, createAIRng('log'))
    expect(hard.debug).toHaveProperty('xMax')
    expect(hard.debug).toHaveProperty('acceptedX')
    expect(hard.debug).toHaveProperty('acceptFloor')
  })
})

describe('AI-11：词条与效果统一入口', () => {
  it('11-1 属性效果通过 getEffectiveDims 读取', () => {
    const main = makeCard('O11', { owner: 'user', faceUp: true, stats: { chaos: 2, barren: 2, disqualification: 0, calamity: 0 } })
    const effectCard = makeCard('A14', { owner: 'ai' })
    const state = minimalState({
      actor: 'ai',
      firstPlayer: 'user',
      round: 4,
      hand: [effectCard],
      board: [main, null, null, null, null, null],
    })
    const revealed = revealStep(step(state, { actor: 'ai', assignments: { 2: effectCard.uid } }))
    const effective = RulesEngine.getEffectiveDims(revealed.board[0])
    expect(effective.barren).toBe(4)
    expect(effective.chaos).toBe(2)
  })

  it('11-2 抽牌效果通过 step/reveal 改变手牌与牌库数量', () => {
    const rainCard = makeCard('C32', { owner: 'ai' })
    const spareCard = makeCard('O12', { owner: 'ai' })
    const deckCards = [makeCard('O11', { owner: 'ai' }), makeCard('O12', { owner: 'ai', uid: 'deck-second' })]
    const main = makeCard('O11', { owner: 'user', faceUp: true })
    const state = minimalState({
      actor: 'ai',
      firstPlayer: 'user',
      hand: [rainCard, spareCard],
      decks: { ai: deckCards },
      board: [main, null, null, null, null, null],
    })
    const revealed = revealStep(step(state, { actor: 'ai', assignments: { 2: rainCard.uid } }))
    expect(revealed.hands.ai).toHaveLength(2)
    expect(revealed.decks.ai).toHaveLength(1)
  })

  it('11-3 策略文件无卡名或卡牌 ID 特判', () => {
    const strategyText = ['beginner.js', 'regular.js', 'hard.js'].map(sourceText).join('\n')
    const forbiddenPatterns = [/A11\./, /A14/, /B11\./, /C11\./, /O11/, /Y12/, /蚁穴/, /饥馑/, /蜂巢/, /if\s*\(\s*card\.id\s*===/]
    for (const pattern of forbiddenPatterns) {
      expect(strategyText).not.toMatch(pattern)
    }
  })

  it('11-4 困难阶估值完成整回合结算', () => {
    const text = sourceText('./hard.js')
    expect(text).toContain('settleRound(state, { [actor]: assignment })')
    expect(text).toContain('settleRound(afterAI')
  })
})

describe('AI-12：最终轻量检查', () => {
  it('最终检查清单可复核', () => {
    expect(AI_DIFFICULTIES).toEqual(['beginner', 'regular', 'hard'])
    expect(AIConfig.FIRST_COMPENSATION).toBe(0)
    expect(LegalActions).toHaveProperty('enumerateAssignments')
    expect(RulesEngine).toHaveProperty('step')
    expect(getAcceptFloor('ai', 3, AIConfig, 'ai')).toBe(AIConfig.hard.FIRST_ACCEPT[0])
  })
})

describe('AI-13：困难阶不出牌回归', () => {
  it('13-1 后手出牌与全空必须产生不同的结算估值', () => {
    const main = makeCard('O11', {
      owner: 'user',
      uid: 'regression-main',
      faceUp: false,
      stats: { chaos: 2, barren: 0, disqualification: 0, calamity: 0 },
    })
    const card = makeCard('O11', {
      owner: 'ai',
      uid: 'regression-play',
      stats: { chaos: 5, barren: 0, disqualification: 0, calamity: 0 },
    })
    const state = minimalState({
      actor: 'ai',
      firstPlayer: 'user',
      hand: [card],
      board: [main, null, null, null, null, null],
    })
    const emptyX = calculateHardX(state, 'ai', {})
    const playedX = calculateHardX(state, 'ai', { 2: card.uid })
    expect(playedX).toBeGreaterThan(emptyX)
  })

  it('13-2 消极分支先取较高 x，不让全空凭低成本胜出', () => {
    const state = minimalState({ actor: 'ai', firstPlayer: 'user', round: 3 })
    const candidates = [{}, { 2: 'low-card' }]
    const chosen = chooseHardAction(candidates, [0.1, 0.4], state, {
      actor: 'ai',
      acceptFloor: 0.5,
    })
    expect(chosen.passive).toBe(true)
    expect(chosen.assignment).toEqual({ 2: 'low-card' })
    expect(chosen.x).toBe(0.4)
  })

  it('13-3 平坦估值回退常规阶并实际出牌', () => {
    const card = makeCard('O11', {
      owner: 'ai',
      uid: 'flat-play',
      stats: { chaos: 5, barren: 0, disqualification: 0, calamity: 0 },
    })
    const main = makeCard('O11', { owner: 'user', uid: 'flat-main' })
    const state = minimalState({
      actor: 'ai',
      firstPlayer: 'user',
      hand: [card],
      board: [main, null, null, null, null, null],
    })
    const result = HardPolicy(state, 'ai', AIConfig, createAIRng('flat-evaluation'), {
      context: { actor: 'ai', evaluator: () => 0.5 },
    })
    expect(result.debug.flatEvaluation).toBe(true)
    expect(Object.keys(result.assignments).length).toBeGreaterThan(0)
  })
})
