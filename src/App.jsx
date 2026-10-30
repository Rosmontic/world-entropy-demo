import { useEffect, useMemo, useState } from 'react'
import './App.css'
import CardView from './components/CardView'
import {
  CARD_LIST, CARD_COPY_LIMIT, DECK_MAX_SIZE, DIMENSIONS, LEVEL_DECK_LIMITS,
  PLAYABLE_CARD_LIST, SERIES_OPTIONS, buildRandomDeckRecipe, canPlay, chooseAiCard,
  completeRound, createGame, currentSlot, definition, openRetention, phaseName, placeCard,
  revealStep, skipSlot, slotsFor, stopTurn, validateDeckRecipe,
} from './game/engine'

const PHASES = ['抽牌', '维度', '出牌', '拼点', '结算', '保留']
const LEVELS = ['全部', '纯净', '萌芽', '灾祸', '崩坏', '终末', '隐秘']
const LIMITED_LEVELS = ['灾祸', '崩坏', '终末', '隐秘']

function Modal({ title, eyebrow, children, onClose, wide = false }) {
  useEffect(() => {
    const close = (event) => event.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
          {onClose && <button className="icon-button" onClick={onClose} aria-label="关闭">×</button>}
        </header>
        {children}
      </section>
    </div>
  )
}

function countsFromRecipe(recipe) {
  const counts = Object.fromEntries(PLAYABLE_CARD_LIST.map((card) => [card.id, 0]))
  for (const [id, count] of recipe) counts[id] = count
  return counts
}

function App() {
  const [game, setGame] = useState(createGame)
  const [started, setStarted] = useState(false)
  const [selected, setSelected] = useState(null)
  const [retainUid, setRetainUid] = useState(null)
  const [modal, setModal] = useState(null)
  const [libraryFilter, setLibraryFilter] = useState('全部')
  const [search, setSearch] = useState('')
  const [logOpen, setLogOpen] = useState(false)
  const [deckMode, setDeckMode] = useState('random')
  const [seriesTendency, setSeriesTendency] = useState('均衡')
  const [builderCounts, setBuilderCounts] = useState(() => countsFromRecipe(buildRandomDeckRecipe()))
  const [activeDeckConfig, setActiveDeckConfig] = useState({ userRecipe: null, aiRecipe: null })

  const userTurn = started && game.phase === 'play' && game.turn.player === 'user'
  const activeSlot = currentSlot(game)
  const selectedCard = game.hands.user.find((card) => card.uid === selected)
  const builderRecipe = useMemo(
    () => Object.entries(builderCounts).filter(([, count]) => count > 0),
    [builderCounts],
  )
  const builderValidation = useMemo(() => validateDeckRecipe(builderRecipe), [builderRecipe])

  useEffect(() => {
    if (!started || game.phase !== 'play' || game.turn.player !== 'ai') return undefined
    const timer = window.setTimeout(() => {
      setGame((previous) => {
        const uid = chooseAiCard(previous)
        return uid ? placeCard(previous, uid) : stopTurn(previous)
      })
    }, 720)
    return () => window.clearTimeout(timer)
  }, [started, game])

  useEffect(() => {
    if (!started || game.phase !== 'reveal') return undefined
    const timer = window.setTimeout(() => setGame((previous) => revealStep(previous)), 720)
    return () => window.clearTimeout(timer)
  }, [started, game])

  const restart = () => {
    setGame(createGame(activeDeckConfig))
    setSelected(null)
    setRetainUid(null)
    setModal(null)
    setStarted(true)
  }

  const filteredCards = useMemo(() => CARD_LIST.filter((card) => {
    const levelMatch = libraryFilter === '全部' || card.level === libraryFilter
    const query = search.trim().toLowerCase()
    return levelMatch && (!query || `${card.id}${card.name}${card.text}`.toLowerCase().includes(query))
  }), [libraryFilter, search])

  const levelCount = (level) => builderValidation.levelCounts[level] || 0

  const canIncreaseCard = (def) => {
    const count = builderCounts[def.id] || 0
    if (count >= CARD_COPY_LIMIT || builderValidation.total >= DECK_MAX_SIZE) return false
    const levelLimit = LEVEL_DECK_LIMITS[def.level]
    return !levelLimit || levelCount(def.level) < levelLimit
  }

  const changeCardCount = (def, delta) => {
    if (delta > 0 && !canIncreaseCard(def)) return
    setBuilderCounts((previous) => ({
      ...previous,
      [def.id]: Math.max(0, Math.min(CARD_COPY_LIMIT, (previous[def.id] || 0) + delta)),
    }))
  }

  const fillBuilder = () => {
    setBuilderCounts(countsFromRecipe(buildRandomDeckRecipe({ tendency: seriesTendency })))
  }

  const clearBuilder = () => {
    setBuilderCounts(countsFromRecipe([]))
  }

  const startGame = () => {
    let config
    if (deckMode === 'random') {
      config = {
        userRecipe: buildRandomDeckRecipe({ tendency: seriesTendency }),
        aiRecipe: buildRandomDeckRecipe({ tendency: seriesTendency }),
      }
    } else {
      if (!builderValidation.valid) return
      config = {
        userRecipe: builderRecipe,
        aiRecipe: buildRandomDeckRecipe({
          tendency: SERIES_OPTIONS[Math.floor(Math.random() * SERIES_OPTIONS.length)],
        }),
      }
    }
    setActiveDeckConfig(config)
    setGame(createGame(config))
    setSelected(null)
    setRetainUid(null)
    setModal(null)
    setStarted(true)
  }

  const playOnSlot = (slot) => {
    if (!userTurn || slot !== activeSlot || !selected) return
    setGame((previous) => placeCard(previous, selected))
    setSelected(null)
  }

  const resultTitle = game.roundResult?.winner === 'tie'
    ? '世界保持叠加'
    : game.roundResult?.winner === 'user' ? '你取得了校订权' : '对手取得了校订权'

  const phaseIndex = { play: 2, reveal: 3, roundEnd: 4, retain: 5, gameOver: 4 }[game.phase]

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <button className="brand" onClick={() => setStarted(false)} aria-label="返回标题">
          <span className="brand-sigil">WE</span>
          <span><strong>世界熵</strong><small>WORLD ENTROPY</small></span>
        </button>
        <nav>
          <button onClick={() => setModal('library')}>卡牌库 <span>{CARD_LIST.length}</span></button>
          <button onClick={() => setModal('rules')}>校订规则</button>
          <a href="https://github.com/Rosmontic/world-entropy-demo" target="_blank" rel="noreferrer">GitHub ↗</a>
          <button className="icon-button mobile-log" onClick={() => setLogOpen(!logOpen)} aria-label="切换记录">☷</button>
        </nav>
      </header>

      <main className="game-layout">
        <section className="game-main">
          <div className="match-strip">
            <div className="round-block"><span className="eyebrow">CURRENT REVISION</span><strong>第 {game.round} 回合</strong></div>
            <div className="score-block player-score"><span>你的校订权</span><strong>{game.wins.user}</strong></div>
            <div className="score-versus">先到 5 胜<em>／</em><span>{game.firstPlayer === 'user' ? '你先手' : '对手先手'}</span></div>
            <div className="score-block ai-score"><span>对手校订权</span><strong>{game.wins.ai}</strong></div>
            <button className="text-button restart-button" onClick={restart}>重新开始</button>
          </div>

          <div className="phase-track">
            {PHASES.map((phase, index) => <div key={phase} className={`${index < phaseIndex ? 'done' : ''} ${index === phaseIndex ? 'active' : ''}`}><i>{index + 1}</i><span>{phase}</span></div>)}
          </div>

          <section className="world-panel">
            <div className="dimension-bar">
              <div><span className="eyebrow">ACTIVE DIMENSIONS</span><strong>本回合计分维度</strong></div>
              <div className="dimension-pills">
                {game.dimensions.map((id) => {
                  const dim = DIMENSIONS.find((item) => item.id === id)
                  return <span key={id} style={{ '--dim-color': dim.color }}><i />{dim.name}</span>
                })}
              </div>
              <div className="phase-callout"><i className={game.phase === 'play' ? 'pulse' : ''} />{phaseName(game)}</div>
            </div>

            <div className="board-head">
              <span>01／公共主世界决定乘数</span>
              <span>02—06／里世界提供加数</span>
            </div>
            <div className="board-grid">
              {game.board.map((card, index) => {
                const slot = index + 1
                const owner = slotsFor('user', game.firstPlayer).includes(slot) ? 'user' : 'ai'
                const isActive = userTurn && activeSlot === slot
                return (
                  <div
                    key={slot}
                    className={`board-slot ${slot === 1 ? 'main-slot' : ''} ${isActive ? 'active-slot' : ''} ${card ? 'occupied' : ''}`}
                    onClick={() => playOnSlot(slot)}
                  >
                    <div className="slot-label"><span>{String(slot).padStart(2, '0')}</span><small>{slot === 1 ? '主世界' : '里世界'}</small></div>
                    {card ? (
                      <>
                        <CardView card={card} compact faceUp={card.faceUp || card.owner === 'user'} />
                        {!card.faceUp && <span className="covered-tag">已盖放</span>}
                      </>
                    ) : (
                      <div className="empty-slot">
                        <span className="slot-cross">＋</span>
                        <small>{isActive ? (selectedCard ? `放置「${definition(selectedCard).name}」` : '从手牌选择一张') : owner === 'user' ? '你的位置' : '对手位置'}</small>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="action-bar">
              <div className="turn-message">
                <span className="eyebrow">{userTurn ? 'YOUR OBSERVATION' : 'OPPOSING OBSERVER'}</span>
                <strong>{game.phase === 'reveal' ? '世界正在逐张显现' : game.phase === 'play' ? (userTurn ? `请选择卡牌，放入 ${activeSlot} 号位` : '对手正在植入世界……') : phaseName(game)}</strong>
              </div>
              <button className="secondary-button" disabled={!userTurn} onClick={() => setGame((previous) => skipSlot(previous))}>跳过此位</button>
              <button className="secondary-button" disabled={!userTurn} onClick={() => setGame((previous) => stopTurn(previous))}>停止出牌</button>
            </div>
          </section>

          <section className="hand-section">
            <div className="hand-title"><div><span className="eyebrow">YOUR ARCHIVE</span><h2>手牌 <span>{game.hands.user.length}／8</span></h2></div><p>崩坏级第 4 回合开放 · 终末级第 7 回合开放</p></div>
            <div className="hand-row">
              {game.hands.user.map((card) => {
                const legal = userTurn && canPlay(card, activeSlot, game.round)
                return <CardView key={card.uid} card={card} selected={selected === card.uid} disabled={!userTurn} className={!legal && userTurn ? 'illegal' : ''} onClick={() => setSelected(selected === card.uid ? null : card.uid)} />
              })}
              {!game.hands.user.length && <div className="empty-hand">手牌已空。你可以停止出牌，让世界直接结算。</div>}
            </div>
          </section>
        </section>

        <aside className={`observer-log ${logOpen ? 'open' : ''}`}>
          <div className="log-header"><div><span className="eyebrow">OBSERVATION LOG</span><h2>校订记录</h2></div><span className="live-dot">LIVE</span></div>
          <div className="deck-stats">
            <button className="deck-stat" onClick={() => setModal('deck')}><span>牌库</span><strong>{game.decks.user.length}</strong></button>
            <button className="deck-stat" onClick={() => setModal('discard')}><span>弃牌</span><strong>{game.discards.user.length}</strong></button>
            <div><span>放逐</span><strong>{game.exiles.user.length}</strong></div>
          </div>
          <div className="log-list">
            {game.logs.map((log) => <div key={log.id} className={`log-item log-${log.type}`}><span>R{log.round}</span><p>{log.text}</p></div>)}
          </div>
          <div className="lore-note"><span>档案注记</span><p>“世界并未消失。它只是不再同意，自己只能是一种样子。”</p></div>
        </aside>
      </main>

      {!started && (
        <div className="title-screen">
          <div className="title-noise" />
          <div className="title-content">
            <span className="title-kicker">AN ARCHIVE OF COLLAPSING WORLDS</span>
            <div className="title-symbol"><i /><span>WE</span><i /></div>
            <h1>世界熵</h1><h3>WORLD ENTROPY</h3>
            <p className="title-lead">当现实失去唯一的解释，<br />你将选择让世界成为什么。</p>
            <button className="primary-button start-button" onClick={() => setModal('deckSetup')}><span>开始校订</span><small>选择或构筑 30～40 张卡组</small></button>
            <div className="title-features"><span>公共主世界</span><i /> <span>暗牌显现</span><i /><span>卡组构筑</span></div>
            <button className="title-rules" onClick={() => setModal('rules')}>首次观测？阅读规则</button>
          </div>
          <div className="title-footer"><span>DEMO BUILD 0.1.0</span><span>卡牌数据与图片资源独立维护</span></div>
        </div>
      )}

      {modal === 'deckSetup' && (
        <Modal title="选择卡组" eyebrow="DECK CONSTRUCTION" wide onClose={() => setModal(null)}>
          <div className="setup-modes">
            <button className={deckMode === 'random' ? 'active' : ''} onClick={() => setDeckMode('random')}>系统随机构筑</button>
            <button className={deckMode === 'custom' ? 'active' : ''} onClick={() => setDeckMode('custom')}>自行构筑卡组</button>
          </div>

          {deckMode === 'random' ? (
            <div className="setup-section">
              <p className="setup-intro">系统将为双方分别生成 30～40 张合法卡组，并在构建时遵守同名与等级数量限制。</p>
              <div className="filter-row series-row">
                {SERIES_OPTIONS.map((series) => <button key={series} className={seriesTendency === series ? 'active' : ''} onClick={() => setSeriesTendency(series)}>{series === '均衡' ? '均衡' : `${series} 系列倾向`}</button>)}
              </div>
            </div>
          ) : (
            <div className="setup-section">
              <div className="builder-summary">
                <div><span>总数</span><strong>{builderValidation.total}／{DECK_MAX_SIZE}</strong></div>
                {LIMITED_LEVELS.map((level) => {
                  const count = levelCount(level)
                  const limit = LEVEL_DECK_LIMITS[level]
                  return <div key={level} className={count > limit ? 'over' : ''}><span>{level}</span><strong>{count}／{limit}</strong></div>
                })}
                <div><span>同名</span><strong>≤ {CARD_COPY_LIMIT}</strong></div>
              </div>
              {!builderValidation.valid && (
                <div className="builder-errors">
                  {builderValidation.errors.map((error) => <p key={error} className="builder-error">{error}</p>)}
                </div>
              )}
              <div className="builder-actions">
                <button className="secondary-button" onClick={fillBuilder}>按当前倾向随机填充</button>
                <button className="secondary-button" onClick={clearBuilder}>清空卡组</button>
              </div>
              <div className="builder-list">
                {PLAYABLE_CARD_LIST.map((def) => {
                  const count = builderCounts[def.id] || 0
                  const stats = DIMENSIONS.map((dim) => `${dim.short}${def.stats[dim.id]}`).join('／')
                  return (
                    <div key={def.id} className={`builder-row ${count > 0 ? 'selected' : ''}`}>
                      <span className="builder-series">{def.series}</span>
                      <div className="builder-card">
                        <strong>{def.id}－{def.name}</strong>
                        <small>{def.level} · {stats}</small>
                      </div>
                      <div className="count-controls">
                        <button onClick={() => changeCardCount(def, -1)} disabled={!count} aria-label={`减少${def.name}`}>−</button>
                        <b>{count}</b>
                        <button onClick={() => changeCardCount(def, 1)} disabled={!canIncreaseCard(def)} aria-label={`增加${def.name}`}>＋</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="setup-footer">
            <p>组卡规则：30～40 张；同名至多 {CARD_COPY_LIMIT} 张；灾祸≤{LEVEL_DECK_LIMITS['灾祸']}、崩坏≤{LEVEL_DECK_LIMITS['崩坏']}、终末≤{LEVEL_DECK_LIMITS['终末']}、隐秘≤{LEVEL_DECK_LIMITS['隐秘']}。</p>
            <button className="primary-button setup-start" disabled={deckMode === 'custom' && !builderValidation.valid} onClick={startGame}>确认并开始</button>
          </div>
        </Modal>
      )}

      {modal === 'deck' && (
        <Modal title={`你的牌库（${game.decks.user.length}）`} eyebrow="YOUR DECK" wide onClose={() => setModal(null)}>
          {game.decks.user.length ? (
            <div className="library-grid zone-grid">{game.decks.user.map((card) => <CardView key={card.uid} card={card} faceUp />)}</div>
          ) : <p className="zone-empty">牌库为空。弃牌区会在下一次抽牌时洗回牌库。</p>}
        </Modal>
      )}

      {modal === 'discard' && (
        <Modal title={`你的弃牌区（${game.discards.user.length}）`} eyebrow="YOUR DISCARD" wide onClose={() => setModal(null)}>
          {game.discards.user.length ? (
            <div className="library-grid zone-grid">{game.discards.user.map((card) => <CardView key={card.uid} card={card} faceUp />)}</div>
          ) : <p className="zone-empty">弃牌区为空。</p>}
        </Modal>
      )}

      {game.phase === 'roundEnd' && game.roundResult && (
        <Modal title={resultTitle} eyebrow={`ROUND ${game.round} · RESOLVED`}>
          <div className="result-score"><div><span>你的分数</span><strong>{game.roundResult.userScore}</strong></div><i>：</i><div><span>对手分数</span><strong>{game.roundResult.aiScore}</strong></div></div>
          <p className="result-description">{game.roundResult.winner === 'tie' ? '双方各获得 1 个胜点。若同时达到 5 胜，将继续决胜回合。' : '本回合胜者获得 1 个胜点。主世界将在下一回合重新校准。'}</p>
          <div className="result-formula">计分维度：{game.roundResult.dimensions.map((id) => DIMENSIONS.find((d) => d.id === id).name).join('、')}</div>
          <button className="primary-button full-button" onClick={() => { setRetainUid(game.hands.user[0]?.uid || null); setGame((previous) => openRetention(previous)) }}>进入弃牌与保留</button>
        </Modal>
      )}

      {game.phase === 'retain' && (
        <Modal title="保留一段尚未消失的可能" eyebrow="END OF ROUND" wide>
          <p className="modal-intro">选择至多 1 张手牌保留至下一回合，其余手牌将被弃置。保留会触发对应效果。</p>
          <div className="retain-grid">
            {game.hands.user.map((card) => <CardView key={card.uid} card={card} selected={retainUid === card.uid} onClick={() => setRetainUid(retainUid === card.uid ? null : card.uid)} />)}
            {!game.hands.user.length && <p>没有可保留的手牌。</p>}
          </div>
          <button className="primary-button full-button" onClick={() => { setGame((previous) => completeRound(previous, retainUid)); setRetainUid(null) }}>完成校订，进入下一回合</button>
        </Modal>
      )}

      {game.phase === 'gameOver' && (
        <Modal title={game.gameWinner === 'user' ? '世界采用了你的解释' : '你的名字消失在档案之外'} eyebrow="REVISION COMPLETE">
          <div className="final-sigil">{game.gameWinner === 'user' ? 'WE' : '∅'}</div>
          <p className="result-description">最终校订权：你 {game.wins.user}／对手 {game.wins.ai}。本次 DEMO 对局已经完成。</p>
          <button className="primary-button full-button" onClick={restart}>再次校订</button>
        </Modal>
      )}

      {modal === 'library' && (
        <Modal title="灾厄卡牌库" eyebrow="INDEPENDENT CARD DATABASE" wide onClose={() => setModal(null)}>
          <div className="library-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="检索编号、名称或效果……" aria-label="搜索卡牌" /><a href="https://github.com/Rosmontic/world-entropy-cards" target="_blank" rel="noreferrer">数据仓库 ↗</a><a href="https://github.com/Rosmontic/world-entropy-assets" target="_blank" rel="noreferrer">图片仓库 ↗</a></div>
          <div className="filter-row">{LEVELS.map((level) => <button key={level} className={libraryFilter === level ? 'active' : ''} onClick={() => setLibraryFilter(level)}>{level}</button>)}</div>
          <div className="library-grid">{filteredCards.map((card) => <CardView key={card.id} card={card} />)}</div>
        </Modal>
      )}

      {modal === 'rules' && (
        <Modal title="校订规则速查" eyebrow="HOW TO PLAY" wide onClose={() => setModal(null)}>
          <div className="rules-layout">
            <section><span className="rule-number">01</span><h3>目标</h3><p>与对手争夺同一世界的解释权。每回合高分者获得 1 胜点，同分各得 1 点；先到 5 胜。</p></section>
            <section><span className="rule-number">02</span><h3>组卡</h3><p>卡组 30～40 张，同名至多 3 张；灾祸级≤12、崩坏级≤7、终末级≤3、隐秘级≤6。可自行构筑，也可由系统按系列倾向随机构筑。</p></section>
            <section><span className="rule-number">03</span><h3>放置</h3><p>先手使用 1、3、5 号位，后手使用 2、4、6 号位，可单独跳过当前位置。1 号主世界默认明牌，其余里世界默认暗牌。若先手结束放置时主世界为空，系统将明牌置入「存在」。</p></section>
            <section><span className="rule-number">04</span><h3>显现</h3><p>双方停止出牌后，按 1→6 逐张翻开并结算效果。主世界是双方公共乘数，里世界分别提供加数。</p></section>
            <section><span className="rule-number">05</span><h3>保留</h3><p>回合结束至多保留 1 张手牌。每回合开始补至 5 张；先手交替，高等级卡牌随回合开放。牌库与弃牌区可随时查看。</p></section>
          </div>
          <div className="formula-box"><span>默认计分公式</span><code>先手＝Σ 主世界 ×（3号＋5号）</code><code>后手＝Σ 主世界 ×（2号＋4号＋6号）</code></div>
          <div className="rules-dims">{DIMENSIONS.map((dim) => <span key={dim.id} style={{ '--dim-color': dim.color }}><i />{dim.name}</span>)}</div>
        </Modal>
      )}
    </div>
  )
}

export default App
