import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'

import { net, useNet } from '../net/net'
import { useQuality } from '../store/quality'
import { useUI } from '../store/ui'
import ChatBubbles from './ChatBubbles'
import CrystalField from './crystals/CrystalField'
import WeatherParticles from './effects/WeatherParticles'
import FirstPersonTool from './FirstPersonTool'
import FollowCamera from './FollowCamera'
import InteractionDriver from './InteractionDriver'
import Lighting from './Lighting'
import Lobby from './lobby/Lobby'
import PlayerController from './PlayerController'
import RemotePlayers from './RemotePlayers'
import { cameraState, localPlayer } from './localPlayer'
import { addBall } from './terrain/digStore'
import { groundTop, surfaceAt } from './terrain/solid'
import { SKY } from './sceneStyle'
import Sky from './Sky'
import TutorialArrow from './TutorialArrow'
import { FloatTextDriver, LabelDriver } from './WorldLabels'
import { uTime } from './world/materials'

// The mountain is its own chunk: the base renders first, the mountain streams in.
const MountainStage = lazy(() => import('./mountain/MountainStage'))

const PerfPanel = import.meta.env.DEV ? lazy(() => import('./debug/PerfPanel')) : null
const showPerf = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf')

/** Handles WebGL context loss: stop, tell the UI, remount the canvas on restore. */
function ContextGuard({ onRestore }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const lost = (e) => {
      e.preventDefault()
      useUI.setState({ contextLost: true })
    }
    const restored = () => {
      useUI.setState({ contextLost: false })
      onRestore()
    }
    el.addEventListener('webglcontextlost', lost)
    el.addEventListener('webglcontextrestored', restored)
    return () => {
      el.removeEventListener('webglcontextlost', lost)
      el.removeEventListener('webglcontextrestored', restored)
    }
  }, [gl, onRestore])
  return null
}

/** Fires once the first frame has actually been drawn. */
function FirstFrame({ onFirstFrame }) {
  const done = useRef(false)
  useFrame(() => {
    if (done.current) return
    done.current = true
    // Leave the frame loop before touching React state.
    setTimeout(onFirstFrame, 0)
  })
  return null
}

/** Advances the shared shader clock (twinkles, sways, shimmer). */
function TimeDriver() {
  useFrame((state) => {
    uTime.value = state.clock.elapsedTime
  })
  return null
}

/** Exposes renderer stats for the automated perf check (dev / ?perf only). */
function DebugHook() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    if (!import.meta.env.DEV && !showPerf) return undefined
    window.__perf = () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, ...gl.info.memory })
    // Lets the automated check move the player and camera to each stage.
    window.__game = {
      localPlayer,
      cameraState,
      setPreset: (p) => useQuality.getState().setPreset(p),
      ground: (x, z) => groundTop(x, z),
      /** Volume pipeline counters (same module instance as the mountain stage). */
      volumes: () => import('./mountain/volumes').then((v) => v.volumeStats()),
      /** Stress test: carves `n` local-only tunnel balls on random walks around (x, z). */
      carveTunnels: (x, z, n, r = 1.3) => {
        let px = x
        let pz = z
        let py = surfaceAt(x, z) - 1
        for (let i = 0; i < n; i += 1) {
          if (i % 40 === 0) {
            px = x + (Math.random() - 0.5) * 60
            pz = z + (Math.random() - 0.5) * 60
            py = surfaceAt(px, pz) - 0.5
          }
          const a = Math.random() * Math.PI * 2
          px += Math.cos(a) * r
          pz += Math.sin(a) * r
          py += (Math.random() - 0.6) * r
          addBall(px, Math.max(1.2, py), pz, r)
        }
      },
      /** Shows a pickaxe in your hand locally (looks only; the server still decides). */
      previewPickaxe: (id) => {
        const me = useNet.getState().me
        if (me) useNet.setState({ me: { ...me, pickaxe: id } })
      },
      surface: (x, z) => surfaceAt(x, z),
      /** The live room, for tests that stage crystals on screen. */
      room: () => net.room,
      bumpWorld: () => useNet.setState((s) => ({ worldVersion: s.worldVersion + 1 })),
      state: () => ({
        me: useNet.getState().me,
        crystals: net.room?.state.crystals.size ?? 0,
        digs: net.room?.state.digs.length ?? 0,
        players: net.room?.state.players.size ?? 0,
      }),
      /** Triangle count per visible mesh, biggest first (perf budgeting). */
      meshes: () => {
        const out = []
        scene.traverseVisible((o) => {
          if (!o.isMesh || !o.geometry) return
          const g = o.geometry
          const tris = (g.index ? g.index.count : g.attributes.position.count) / 3
          const tag = o.name || `${o.isInstancedMesh ? 'inst' : o.isSkinnedMesh ? 'skin' : 'mesh'}:${o.material?.type ?? ''}:${o.parent?.type ?? ''}`
          out.push({ name: tag, tris: Math.round(tris * (o.isInstancedMesh ? o.count : 1)) })
        })
        return out.sort((a, b) => b.tris - a.tris).slice(0, 15)
      },
    }
    return () => {
      delete window.__perf
      delete window.__game
    }
  }, [gl, scene])
  return null
}

/** Applies the preset's view distance to the live camera. */
function CameraFar({ far }) {
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    camera.far = far
    camera.updateProjectionMatrix()
  }, [camera, far])
  return null
}

function Fog() {
  const near = useQuality((s) => s.settings.fogNear)
  const far = useQuality((s) => s.settings.fogFar)
  return <fog attach="fog" args={[SKY.horizon, near, far]} />
}

export default function GameCanvas({ onAvatarReady }) {
  const settings = useQuality((s) => s.settings)
  const drop = useQuality((s) => s.drop)
  const [canvasKey, setCanvasKey] = useState(0)
  const restore = useCallback(() => setCanvasKey((k) => k + 1), [])
  const [stageReady, setStageReady] = useState(false)
  const onFirstFrame = useCallback(() => setStageReady(true), [])

  return (
    <Canvas
      // Remount on context restore, and when shadows toggle (materials must recompile).
      key={`${canvasKey}-${settings.shadows}-${settings.antialias}`}
      shadows={settings.shadows ? 'percentage' : false}
      flat
      dpr={settings.dpr}
      gl={{ antialias: settings.antialias, powerPreference: 'high-performance', stencil: false }}
      camera={{ position: [0, 6, 40], fov: 60, near: 0.2, far: settings.far }}
      onCreated={({ gl }) => gl.setClearColor(SKY.horizon)}
    >
      <ContextGuard onRestore={restore} />
      <TimeDriver />
      <DebugHook />
      <CameraFar far={settings.far} />
      <PerformanceMonitor bounds={() => [45, 1000]} flipflops={3} onDecline={drop} />
      <Fog />
      <Sky />
      <Lighting />
      <Lobby />
      <CrystalField />
      <PlayerController onReady={onAvatarReady} />
      <RemotePlayers />
      <WeatherParticles />
      {stageReady && (
        <Suspense fallback={null}>
          <MountainStage />
        </Suspense>
      )}
      <FollowCamera />
      <FirstPersonTool />
      <InteractionDriver />
      <LabelDriver />
      <FloatTextDriver />
      <ChatBubbles />
      <TutorialArrow />
      <FirstFrame onFirstFrame={onFirstFrame} />
      {PerfPanel && showPerf && (
        <Suspense fallback={null}>
          <PerfPanel />
        </Suspense>
      )}
    </Canvas>
  )
}
