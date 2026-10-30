import { useQuality } from '../store/quality'
import { useUI } from '../store/ui'
import { sfx } from '../game/audio'

/** Shared modal chrome: dark panel, white border, red X, optional header extras. */
export default function Modal({ title, children, width = 'min(1040px, 94vw)', headerExtra, onClose }) {
  const blur = useQuality((s) => s.preset !== 'LOW')
  const close = () => {
    sfx.click()
    if (onClose) onClose()
    else useUI.getState().closeModal()
  }
  return (
    <div
      className={`pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/25 ${blur ? 'backdrop-blur-[3px]' : ''}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      {/* Small screens: the whole panel scales down to fit (--modal-s, set with the HUD
          scale), laid out at its full size so nothing inside reflows or gets cut off. */}
      <div className="snowcap pop-in" style={{ width: `calc(${width} / var(--modal-s, 1))`, scale: 'var(--modal-s, 1)' }}>
        <div className="panel flex flex-col overflow-hidden" style={{ maxHeight: 'calc(86vh / var(--modal-s, 1))' }}>
          <div className="modal-head flex items-center gap-3 px-5 py-3">
            <h2 className="cartoon flex-1 text-[34px] text-white">{title}</h2>
            {headerExtra}
            <button
              type="button"
              onClick={close}
              className="btn btn-red flex h-12 w-12 items-center justify-center text-[28px] font-black text-white"
              aria-label="Close"
            >
              X
            </button>
          </div>
          <div className="scroll-thin overflow-auto p-4">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function RarityTag({ rarity, className = '' }) {
  const colors = ['#9aa0a8', '#2ec43c', '#1f6fe0', '#9b2fe0', '#f59e0b', '#e8336d']
  const names = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic']
  return (
    <span
      className={`cartoon-thin inline-block rounded-lg border-2 border-[#111] px-2 text-[20px] font-bold text-white ${className}`}
      style={{ background: colors[rarity] ?? colors[0] }}
    >
      {names[rarity] ?? 'Common'}
    </span>
  )
}
