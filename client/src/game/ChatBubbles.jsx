import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'

import { hideBubbles, placeBubbles } from './speechBubbles'

/** Places Boxity chat bubbles over the heads they belong to, every frame (see speechBubbles). */
export default function ChatBubbles() {
  const size = useThree((s) => s.size)
  useEffect(() => hideBubbles, [])
  useFrame(({ camera }) => placeBubbles(camera, size.width, size.height))
  return null
}
