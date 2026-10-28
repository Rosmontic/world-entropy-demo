import { DIMENSIONS, definition, displayStat } from '../game/engine'

function artUrl(def) {
  return `${import.meta.env.BASE_URL}art/${def.art}`
}

export default function CardView({ card, faceUp = true, compact = false, selected = false, disabled = false, onClick, className = '' }) {
  const def = definition(card)
  const interactive = Boolean(onClick)
  return (
    <div
      className={`game-card ${compact ? 'compact' : ''} ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''} ${faceUp ? '' : 'face-down'} ${className}`}
      onClick={disabled ? undefined : onClick}
      onKeyDown={interactive ? (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !disabled) onClick?.()
      } : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive && !disabled ? 0 : undefined}
      aria-label={faceUp ? `${def.id} ${def.name}` : '暗牌'}
    >
      {!faceUp ? (
        <div className="card-back">
          <div className="back-orbit"><span>WE</span></div>
          <small>UNOBSERVED</small>
        </div>
      ) : (
        <>
          <div className="card-art-wrap">
            <img src={artUrl(def)} alt={`${def.name}卡图`} className="card-art" draggable="false" />
            <span className={`level level-${def.level}`}>{def.level}</span>
            <span className="card-series">{def.series}</span>
          </div>
          <div className="card-heading">
            <span className="card-id">{def.id}</span>
            <strong>{def.name}</strong>
          </div>
          <div className="card-stats">
            {DIMENSIONS.map((dim) => (
              <div key={dim.id} style={{ '--dim-color': dim.color }} title={dim.name}>
                <span>{dim.short}</span><b>{displayStat(card, dim.id)}</b>
              </div>
            ))}
          </div>
          {!compact && (
            <div className="card-rules">
              {def.keywords.length > 0 && <div className="keyword-row">{def.keywords.map((word) => <span key={word}>｛{word}｝</span>)}</div>}
              <p>{def.text}</p>
            </div>
          )}
          {!compact && <div className="card-flavor">{def.flavor}</div>}
        </>
      )}
    </div>
  )
}
