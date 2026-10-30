import { useEffect, useState } from 'react'

import { serverNow } from '../net/net'

/** Re-renders the caller every `ms` with the server clock (for countdowns). */
export default function useNow(ms = 1000) {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
