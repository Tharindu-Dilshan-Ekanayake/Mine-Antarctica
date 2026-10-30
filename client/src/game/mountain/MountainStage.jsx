import Effects from '../effects/Effects'
import DigMarkers from './DigMarkers'
import MountainDecor from './MountainDecor'
import MountainTerrain from './MountainTerrain'

/**
 * The mountain stage, code-split from the lobby (React.lazy). The base renders first;
 * the diggable mountain and its effects stream in right after.
 */
export default function MountainStage() {
  return (
    <>
      <MountainTerrain />
      <MountainDecor />
      <DigMarkers />
      <Effects />
    </>
  )
}
