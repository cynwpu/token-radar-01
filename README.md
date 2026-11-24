# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cynwpu/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cynwpu/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's bounty. `main.ts` reads the sealed DefiLlama snapshot, ranks every pre-token protocol by an implied value anchored to the snapshot's own market comparables (each category's median market-cap-to-TVL ratio among token-listed protocols, shrunk toward the market median, adjusted for 7-day TVL momentum and time tracked without a token), writes `board.json` with a concrete farm plan per row, and ships a sortable, filterable dashboard with a per-protocol detail view that shows the value arithmetic.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=eb2tcg9w&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
