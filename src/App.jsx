import { useEffect, useMemo, useState } from 'react'
import './App.css'
import CardView from './components/CardView'
import {
  CARD_LIST, CARD_COPY_LIMIT, DECK_MAX_SIZE, DIMENSIONS, LEVEL_DECK_LIMITS,
  MAX_ROUNDS, PLAYABLE_CARD_LIST, SERIES_OPTIONS, SIGNATURE_LIST, SIGNATURE_MAP,
  buildRandomDeckRecipe, canPlay, chooseAiCard, completeRound, confirmSignatures,
  createGame, currentSlot, definition, placeCard, randomSeed, revealStep,
  seededRandom, selectSignature, selectSlot, shuffle, signatureLabel, signatureText,
  skipSlot, slotsFor, sortCardsForDisplay, beginNextRound, phaseName, stopTurn,
  useAiPilgrimage, usePilgrimage, validateDeckRecipe, validateSignatureLoadout,
} from './game/engine'

const PHASES = ['署名', '抽牌', '维度', '出牌', '拼点', '弃牌与保留', '结算']
const LEVELS = ['全部', '纯净', '萌芽', '灾祸', '崩坏', '终末', '隐秘']
const LIMITED_LEVELS = ['灾祸', '崩坏', '终末']

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

function SignaturePanel({ title, signature }) {
  return (
    <div className={`signature-panel ${signature?.faceUp ? 'revealed' : 'covered'}`}>
      <span>{title}</span>
      <strong>{signature ? signatureLabel(signature) : '0-序言'}</strong>
      <p>{signature ? signatureText(signature) : SIGNATURE_MAP['0'].text}</p>
      {signature && !signature.faceUp && <small>暗牌挂载，尚未生效</small>}
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
  const [signatureLoadout, setSignatureLoadout] = useState([])
  const [activeDeckConfig, setActiveDeckConfig] = useState({ userRecipe: null, aiRecipe: null })
  const [activeSignatureConfig, setActiveSignatureConfig] = useState({ userSignatures: [], aiSignatures: [] })
  const [seedInput, setSeedInput] = useState(() => randomSeed())
  const [activeSeed, setActiveSeed] = useState(() => seedInput)
  const [seedHistory, setSeedHistory] = useState([])
  const [seedCopied, setSeedCopied] = useState(false)
  const [selectedSignature, setSelectedSignature] = useState(null)
  const [signatureConfirmed, setSignatureConfirmed] = useState(false)
  const [pilgrimageModal, setPilgrimageModal] = useState(false)

  const userTurn = started && game.phase === 'play' && game.turn.player === 'user'
  const activeSlot = currentSlot(game)
  const selectedCard = game.hands.user.find((card) => card.uid === selected)
  const builderRecipe = useMemo(
    () => Object.entries(builderCounts).filter(([, count]) => count > 0),
    [builderCounts],
  )
  const builderValidation = useMemo(() => validateDeckRecipe(builderRecipe), [builderRecipe])
  const signatureValidation = useMemo(() => validateSignatureLoadout(signatureLoadout), [signatureLoadout])
  const displayDeck = useMemo(() => sortCardsForDisplay(game.decks.user), [game.decks.user])
  const displayDiscard = useMemo(() => sortCardsForDisplay(game.discards.user), [game.discards.user])
  const signatureChoices = game.phase === 'signature'
    ? (game.signatureLoadouts.user.length ? game.signatureLoadouts.user : game.signatureOptions.user)
    : []
  const userSignature = game.mounts?.user
  const userSignatureDef = userSignature ? SIGNATURE_MAP[userSignature.id] : null
  const canUsePilgrimage = Boolean(userTurn && userSignatureDef?.effect === 'cosmicPilgrimage'
    && userSignature?.faceUp && userSignature.chargesRemaining > 0 && !game.pilgrimageUsed.user)
  const retainTargets = game.hands.user.filter((card) => definition(card).trigger === '保留')

  useEffect(() => {
    if (!started || game.phase !== 'play' || game.turn.player !== 'ai') return undefined
    const timer = window.setTimeout(() => {
      setGame((previous) => {
        const pilgrimaged = useAiPilgrimage(previous)
        if (pilgrimaged !== previous) return pilgrimaged
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

  const rememberSeed = (seed) => {
    setSeedHistory((previous) => [seed, ...previous.filter((item) => item !== seed)].slice(0, 10))
  }

  const restart = () => {
    const nextSeed = randomSeed()
    setSeedInput(nextSeed)
    setActiveSeed(nextSeed)
    rememberSeed(nextSeed)
    setSignatureConfirmed(false)
    setSelectedSignature(null)
    setPilgrimageModal(false)
    setGame(createGame({ ...activeDeckConfig, ...activeSignatureConfig, seed: nextSeed, signaturePhase: true }))
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

  const toggleSignature = (id) => {
    setSignatureLoadout((previous) => {
      if (previous.includes(id)) return previous.filter((item) => item !== id)
      if (previous.length >= 3) return previous
      return [...previous, id]
    })
  }

  const fillBuilder = () => {
    setBuilderCounts(countsFromRecipe(buildRandomDeckRecipe({ tendency: seriesTendency })))
  }

  const clearBuilder = () => {
    setBuilderCounts(countsFromRecipe([]))
  }

  const copySeed = async () => {
    try {
      await navigator.clipboard.writeText(activeSeed)
      setSeedCopied(true)
      window.setTimeout(() => setSeedCopied(false), 1200)
    } catch {
      setSeedCopied(false)
    }
  }

  const randomizeSeed = () => {
    const nextSeed = randomSeed()
    setSeedInput(nextSeed)
    setActiveSeed(nextSeed)
  }

  const startGame = () => {
    if (!signatureValidation.valid) return
    const chosenSeed = seedInput.trim() || randomSeed()
    const recipeRng = seededRandom(chosenSeed)
    let recipes
    if (deckMode === 'random') {
      recipes = {
        userRecipe: buildRandomDeckRecipe({ tendency: seriesTendency, rng: recipeRng }),
        aiRecipe: buildRandomDeckRecipe({ tendency: seriesTendency, rng: recipeRng }),
      }
    } else {
      if (!builderValidation.valid) return
      recipes = {
        userRecipe: builderRecipe,
        aiRecipe: buildRandomDeckRecipe({
          tendency: SERIES_OPTIONS[Math.floor(recipeRng() * SERIES_OPTIONS.length)],
          rng: recipeRng,
        }),
      }
    }
    const aiSignaturePool = shuffle(SIGNATURE_LIST.filter((signature) => signature.id !== '0'), recipeRng)
      .slice(0, 3)
      .map((signature) => signature.id)
    const signatureConfig = { userSignatures: signatureLoadout, aiSignatures: aiSignaturePool }
    setActiveDeckConfig(recipes)
    setActiveSignatureConfig(signatureConfig)
    setActiveSeed(chosenSeed)
    setSeedInput(chosenSeed)
    rememberSeed(chosenSeed)
    setSignatureConfirmed(false)
    setSelectedSignature(signatureLoadout[0] || null)
    setPilgrimageModal(false)
    setGame(createGame({ ...recipes, ...signatureConfig, seed: chosenSeed, signaturePhase: true }))
    setSelected(null)
    setRetainUid(null)
    setModal(null)
    setStarted(true)
  }

  const confirmSignatureChoice = () => {
    setGame((previous) => selectSignature(previous, selectedSignature))
    setSignatureConfirmed(true)
  }

  const revealSignatures = () => {
    setGame((previous) => confirmSignatures(previous))
    setSignatureConfirmed(false)
    setSelectedSignature(null)
  }

  const playOnSlot = (slot) => {
    if (!userTurn || !slotsFor('user', game.firstPlayer).includes(slot) || game.board[slot - 1]) return
    if (selected) {
      setGame((previous) => placeCard(selectSlot(previous, slot), selected))
      setSelected(null)
      return
    }
    setGame((previous) => selectSlot(previous, slot))
  }

  const launchPilgrimageDraw = () => {
    setGame((previous) => usePilgrimage(previous, 1))
    setPilgrimageModal(false)
  }

  const launchPilgrimageTarget = (uid) => {
    setGame((previous) => usePilgrimage(previous, 2, uid))
    setPilgrimageModal(false)
  }

  const resultTitle = game.roundResult?.winner === 'tie'
    ? '世界保持叠加'
    : game.roundResult?.winner === 'user' ? '你取得了校订权' : '对手取得了校订权'

  const gameOverTitle = game.gameWinner === 'draw'
    ? '世界没有接受唯一解释'
    : game.gameWinner === 'user' ? '世界采用了你的解释' : '你的名字消失在档案之外'

  const phaseIndex = { signature: 0, play: 3, reveal: 4, retain: 5, roundEnd: 6, gameOver: 6 }[game.phase]

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
            <div className="round-block"><span className="eyebrow">CURRENT REVISION</span><strong>第 {game.round}／{MAX_ROUNDS} 回合</strong></div>
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

            <div className="signature-zones">
              <SignaturePanel title="你的署名" signature={userSignature} />
              <SignaturePanel title="对手署名" signature={game.mounts?.ai} />
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
                const selectable = userTurn && owner === 'user' && !card
                return (
                  <div
                    key={slot}
                    className={`board-slot ${slot === 1 ? 'main-slot' : ''} ${isActive ? 'active-slot' : ''} ${selectable ? 'selectable-slot' : ''} ${card ? 'occupied' : ''}`}
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
                        <small>{selectable ? (selectedCard ? `放置「${definition(selectedCard).name}」` : (isActive ? '当前位置' : '点击选中此位')) : owner === 'user' ? '你的位置' : '对手位置'}</small>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="action-bar">
              <div className="turn-message">
                <span className="eyebrow">{userTurn ? 'YOUR OBSERVATION' : 'OPPOSING OBSERVER'}</span>
                <strong>{game.phase === 'signature' ? '双方正在秘密选择署名' : game.phase === 'reveal' ? '世界正在逐张显现' : game.phase === 'play' ? (userTurn ? `请选择卡牌，放入 ${activeSlot ?? '—'} 号位` : '对手正在植入世界……') : phaseName(game)}</strong>
              </div>
              <button className="secondary-button pilgrimage-button" disabled={!canUsePilgrimage} onClick={() => setPilgrimageModal(true)}>巡礼</button>
              <button className="secondary-button" disabled={!userTurn || !activeSlot} onClick={() => setGame((previous) => skipSlot(previous))}>跳过此位（可返回）</button>
              <button className="secondary-button" disabled={!userTurn} onClick={() => setGame((previous) => stopTurn(previous))}>停止出牌（放弃剩余位置）</button>
            </div>
          </section>

          <section className="hand-section">
            <div className="hand-title"><div><span className="eyebrow">YOUR ARCHIVE</span><h2>手牌 <span>{game.hands.user.length}／8</span></h2></div><p>崩坏级第 4 回合开放 · 终末级第 7 回合开放</p></div>
            <div className="hand-row">
              {game.hands.user.map((card) => {
                const legal = userTurn && canPlay(card, activeSlot, game.round)
                return <CardView key={card.uid} card={card} selected={selected === card.uid} disabled={!userTurn} className={!legal && userTurn ? 'illegal' : ''} onClick={() => setSelected(selected === card.uid ? null : card.uid)} />
              })}
              {!game.hands.user.length && <div className="empty-hand">{game.phase === 'signature' ? '完成署名后将抽取起手牌。' : '手牌已空。你可以跳过当前位置或停止出牌。'}</div>}
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
          <div className="seed-current"><span>当前 seed</span><code>{game.seed}</code></div>
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
            <button className="primary-button start-button" onClick={() => setModal('deckSetup')}><span>开始校订</span><small>选择 seed、署名与 30～40 张卡组</small></button>
            <div className="title-features"><span>公共主世界</span><i /> <span>暗牌显现</span><i /><span>署名机制</span></div>
            <button className="title-rules" onClick={() => setModal('rules')}>首次观测？阅读规则</button>
          </div>
          <div className="title-footer"><span>DEMO BUILD 0.13</span><span>卡牌数据与图片资源独立维护</span></div>
        </div>
      )}

      {modal === 'deckSetup' && (
        <Modal title="选择卡组与署名" eyebrow="DECK CONSTRUCTION · v0.13" wide onClose={() => setModal(null)}>
          <div className="seed-panel">
            <div className="seed-heading"><span className="eyebrow">RANDOM SEED</span><strong>随机种子</strong></div>
            <div className="seed-controls">
              <input value={seedInput} onChange={(event) => { setSeedInput(event.target.value); setActiveSeed(event.target.value) }} placeholder="输入 seed 以复现随机序列" aria-label="随机种子" />
              <button className="secondary-button" onClick={copySeed}>{seedCopied ? '已复制' : '复制 seed'}</button>
              <button className="secondary-button" onClick={randomizeSeed}>随机 seed</button>
            </div>
            {seedHistory.length > 0 && (
              <div className="seed-history" aria-label="最近 seed 历史">
                <span>最近 10 场</span>
                {seedHistory.map((seed) => <button key={seed} onClick={() => { setSeedInput(seed); setActiveSeed(seed) }}>{seed}</button>)}
              </div>
            )}
          </div>

          <div className="signature-setup">
            <div className="signature-setup-head"><div><span className="eyebrow">SIGNATURE LOADOUT</span><strong>署名携带</strong></div><span>{signatureLoadout.length}／3</span></div>
            <div className="signature-options">
              {SIGNATURE_LIST.filter((signature) => signature.id !== '0').map((signature) => (
                <button key={signature.id} className={`signature-option ${signatureLoadout.includes(signature.id) ? 'selected' : ''}`} onClick={() => toggleSignature(signature.id)}>
                  <strong>{signature.id}-{signature.name}</strong>
                  <span>{signature.text}</span>
                </button>
              ))}
            </div>
            <p>署名独立于卡组，最多3张且不可重复；未选择时自动挂载「0-序言」。 {!signatureValidation.valid && <b>{signatureValidation.errors.join('；')}</b>}</p>
          </div>

          <div className="setup-modes">
            <button className={deckMode === 'random' ? 'active' : ''} onClick={() => setDeckMode('random')}>系统随机构筑</button>
            <button className={deckMode === 'custom' ? 'active' : ''} onClick={() => setDeckMode('custom')}>自行构筑卡组</button>
          </div>

          {deckMode === 'random' ? (
            <div className="setup-section">
              <p className="setup-intro">系统将为双方分别生成 30～40 张合法卡组，并使用当前 seed 决定署名选项、洗牌、先后手、维度与结算随机。</p>
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
            <p>组卡规则：30～40 张；同名至多 {CARD_COPY_LIMIT} 张；灾祸≤{LEVEL_DECK_LIMITS['灾祸']}、崩坏≤{LEVEL_DECK_LIMITS['崩坏']}、终末≤{LEVEL_DECK_LIMITS['终末']}；隐秘不限制数量。署名不计入卡组。</p>
            <button className="primary-button setup-start" disabled={(deckMode === 'custom' && !builderValidation.valid) || !signatureValidation.valid} onClick={startGame}>确认并开始</button>
          </div>
        </Modal>
      )}

      {game.phase === 'signature' && started && (
        <Modal title="选择你的署名" eyebrow="SIGNATURE SELECTION" wide>
          {!signatureConfirmed ? (
            <>
              <p className="modal-intro">第1回合{game.firstPlayer === 'user' ? '你' : '对手'}先手。请秘密选择一张署名，确认后等待双方公开；不选则默认挂载「0-序言」。</p>
              <div className="signature-options opening-options">
                <button className={`signature-option ${!selectedSignature ? 'selected' : ''}`} onClick={() => setSelectedSignature(null)}>
                  <strong>0-序言</strong>
                  <span>无效果。</span>
                </button>
                {signatureChoices.map((id) => {
                  const signature = SIGNATURE_MAP[id]
                  return (
                    <button key={id} className={`signature-option ${selectedSignature === id ? 'selected' : ''}`} onClick={() => setSelectedSignature(id)}>
                      <strong>{id}-{signature.name}</strong>
                      <span>{signature.text}</span>
                    </button>
                  )
                })}
              </div>
              <button className="primary-button full-button" onClick={confirmSignatureChoice}>秘密确认</button>
            </>
          ) : (
            <>
              <p className="modal-intro">你已秘密确认署名，等待双方同时公开。</p>
              <div className="waiting-sigil">WE</div>
              <button className="primary-button full-button" onClick={revealSignatures}>同时公开署名</button>
            </>
          )}
        </Modal>
      )}

      {pilgrimageModal && (
        <Modal title="发动寰宇" eyebrow="COSMIC PILGRIMAGE" wide onClose={() => setPilgrimageModal(false)}>
          <p className="modal-intro">选择1项。每次发动消耗1次巡礼次数，且每回合至多发动1次。</p>
          <div className="pilgrimage-options">
            <button className="signature-option" onClick={launchPilgrimageDraw} disabled={game.hands.user.length >= 8}>
              <strong>① 抽取保留牌</strong>
              <span>从己方牌库抽取1张具有[保留]的牌，受手牌上限约束。</span>
            </button>
            <div className="pilgrimage-targets">
              <strong>② 额外触发保留</strong>
              <span>选择己方手牌中1张具有[保留]的牌：</span>
              <div className="retain-grid">
                {retainTargets.map((card) => <CardView key={card.uid} card={card} onClick={() => launchPilgrimageTarget(card.uid)} />)}
                {!retainTargets.length && <p>没有可选择的[保留]手牌。</p>}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'deck' && (
        <Modal title={`你的牌库（${game.decks.user.length}）`} eyebrow="YOUR DECK · SORTED" wide onClose={() => setModal(null)}>
          {displayDeck.length ? (
            <div className="library-grid zone-grid">{displayDeck.map((card) => <CardView key={card.uid} card={card} faceUp />)}</div>
          ) : <p className="zone-empty">牌库为空。弃牌区会在下一次抽牌时洗回牌库。</p>}
        </Modal>
      )}

      {modal === 'discard' && (
        <Modal title={`你的弃牌区（${game.discards.user.length}）`} eyebrow="YOUR DISCARD · SORTED" wide onClose={() => setModal(null)}>
          {displayDiscard.length ? (
            <div className="library-grid zone-grid">{displayDiscard.map((card) => <CardView key={card.uid} card={card} faceUp />)}</div>
          ) : <p className="zone-empty">弃牌区为空。</p>}
        </Modal>
      )}

      {game.phase === 'retain' && (
        <Modal title="保留一段尚未消失的可能" eyebrow={`ROUND ${game.round} · RETAIN BEFORE SCORE`} wide>
          <p className="modal-intro">先完成弃牌与保留，再结算本回合分数。选择至多 1 张手牌保留，其余手牌将触发相应区域规则。</p>
          <div className="retain-grid">
            {game.hands.user.map((card) => <CardView key={card.uid} card={card} selected={retainUid === card.uid} onClick={() => setRetainUid(retainUid === card.uid ? null : card.uid)} />)}
            {!game.hands.user.length && <p>没有可保留的手牌。</p>}
          </div>
          <button className="primary-button full-button" onClick={() => { setGame((previous) => completeRound(previous, retainUid)); setRetainUid(null) }}>完成保留并结算</button>
        </Modal>
      )}

      {game.phase === 'roundEnd' && game.roundResult && (
        <Modal title={resultTitle} eyebrow={`ROUND ${game.round} · RESOLVED`}>
          <div className="result-score"><div><span>你的分数</span><strong>{game.roundResult.userScore}</strong></div><i>：</i><div><span>对手分数</span><strong>{game.roundResult.aiScore}</strong></div></div>
          <p className="result-description">{game.roundResult.winner === 'tie' ? `双方各获得 1 个胜点。若第 ${MAX_ROUNDS} 回合后仍不分胜负，本局为平局。` : '本回合胜者获得 1 个胜点。署名[取胜]效果已在结算最后处理。'}</p>
          <div className="equation-box">
            <span>完整计分算式</span>
            {game.roundResult.equationLines.map((line) => <code key={line}>{line}</code>)}
          </div>
          <button className="primary-button full-button" onClick={() => setGame((previous) => beginNextRound(previous))}>进入下一回合</button>
        </Modal>
      )}

      {game.phase === 'gameOver' && (
        <Modal title={gameOverTitle} eyebrow="REVISION COMPLETE">
          <div className="final-sigil">{game.gameWinner === 'user' ? 'WE' : game.gameWinner === 'ai' ? '∅' : '＝'}</div>
          <p className="result-description">最终校订权：你 {game.wins.user}／对手 {game.wins.ai}。Seed：{game.seed}</p>
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
        <Modal title="校订规则速查" eyebrow="HOW TO PLAY · v0.13" wide onClose={() => setModal(null)}>
          <div className="rules-layout">
            <section><span className="rule-number">01</span><h3>目标</h3><p>最多 {MAX_ROUNDS} 回合。每回合高分者获得 1 胜点，同分各得 1 点；先达 5 且领先者胜，双方同达 5 后逐回合比较，第 {MAX_ROUNDS} 回合后仍平为平局。</p></section>
            <section><span className="rule-number">02</span><h3>署名</h3><p>开局先随机先后手，再秘密选择署名并同时公开。署名进入挂载区，公开可见，不参与四维计分；未选择时自动挂载「0-序言」。</p></section>
            <section><span className="rule-number">03</span><h3>组卡</h3><p>卡组 30～40 张，同名至多 3 张；灾祸级≤12、崩坏级≤7、终末级≤3，隐秘级不限制数量。署名最多携带3张，独立于卡组且不可重复。</p></section>
            <section><span className="rule-number">04</span><h3>出牌与巡礼</h3><p>跳过当前位置后本回合仍可返回；停止出牌才放弃剩余位置。巡礼在自己的出牌阶段手动发动，1局n次、1回合1次，不占用出牌。</p></section>
            <section><span className="rule-number">05</span><h3>显现与光环</h3><p>每次暗转明都会触发 `[显现]`。署名光环先于常规卡牌光环判定与结算；暗牌挂载不生效，翻明后生效。</p></section>
            <section><span className="rule-number">06</span><h3>保留与结算</h3><p>先弃牌与保留，再结算胜负。校订记录保存代入实际数值的完整计分算式； `[取胜]` 在结算阶段最后触发。</p></section>
            <section><span className="rule-number">07</span><h3>随机</h3><p>洗牌、先后手、署名随机选项、维度、随机效果与结算随机共用 seed。可输入、复制或随机生成 seed，并查看最近 10 场记录。</p></section>
          </div>
          <div className="formula-box"><span>默认计分公式</span><code>先手＝Σ 主世界 ×（3号＋5号）</code><code>后手＝Σ 主世界 ×（2号＋4号＋6号）</code></div>
          <div className="rules-dims">{DIMENSIONS.map((dim) => <span key={dim.id} style={{ '--dim-color': dim.color }}><i />{dim.name}</span>)}</div>
        </Modal>
      )}
    </div>
  )
}

export default App
