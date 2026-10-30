import { pressRespawn } from '../bloxity/deathScreen'
import { sfx } from '../game/audio'
import { useUI } from '../store/ui'

/**
 * You froze: a frosty card in the centre of the screen (Boxity puts its banners along
 * the edges) with the game's own Respawn button. The button waits out Boxity's
 * countdown, shown as a number in a ring, and only works once Boxity says so.
 */
export default function DeathCard() {
  const death = useUI((s) => s.death)
  if (!death) return null
  const waiting = death.seconds > 0

  const respawn = () => {
    if (pressRespawn()) sfx.click()
  }

  return (
    <div className="death-frost pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
      <div className="snowcap pop-in pointer-events-auto" style={{ width: 'min(380px, 86vw)' }}>
        <div className="panel flex flex-col items-center gap-2 px-6 pb-6 pt-5 text-center">
          <div className="death-flake text-[54px] leading-none max-sm:text-[42px]" aria-hidden>
            ❄
          </div>
          <h2 className="cartoon text-[40px] leading-none text-white max-sm:text-[32px]">YOU FROZE!</h2>
          <p className="max-w-[300px] text-[15px] font-semibold leading-snug text-[#cfe9ff]">
            It's too cold that high up. Buy more <span className="text-[#ffd84a]">Warmth</span> at the UPGRADES
            stall to climb higher.
          </p>
          <button
            type="button"
            onClick={respawn}
            disabled={waiting}
            className="btn btn-green mt-3 flex h-14 min-w-[200px] items-center justify-center gap-3 px-6 text-[24px] font-black text-white"
          >
            {waiting ? (
              <>
                <span className="death-ring flex h-9 w-9 items-center justify-center rounded-full text-[20px]">
                  {death.seconds}
                </span>
                RESPAWN
              </>
            ) : (
              'RESPAWN'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
