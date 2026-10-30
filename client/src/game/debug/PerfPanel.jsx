import { Perf } from 'r3f-perf'

/** r3f-perf overlay. Dev builds only, and only with ?perf in the URL. */
export default function PerfPanel() {
  return <Perf position="bottom-right" minimal={false} />
}
