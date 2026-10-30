# Risklayer: notes for coding agents

Read `CONTRIBUTING.md` first. It holds the lanes, commit style, the pre-push gate, the UI rules and the honesty rules. The points below are the ones agents most often get wrong.

- **Verdicts:** only the pure functions in `src/verdict/rules.ts` decide them. Never add model-based decisions. Missing evidence must fail closed.
- **The answer envelope** (`src/verdict/envelope.ts`) is a shared contract with the buyer. If you change the hashed fields, update `verifyEnvelope`, the tests and `docs/ARCHITECTURE.md` together.
- **Market data:** always read from HSK mainnet (177). `PAYMENT_NETWORK` only changes where payments settle.
- **Local gateway:** never describe it as HashKey's, and never hide the `simulated` flag.
- **Tests:** run the single test file you changed while iterating. Run the full gate (see `CONTRIBUTING.md`) once, before a push.
- **UI copy:** no em or en dashes in user-visible text. Rewrite by hand; no global find-and-replace.
- **Filenames:** camelCase for TS and TSX.
- **Commits:** do not commit or push unless asked. Use one logical change per commit, with a one-line conventional subject.
- **Dev servers:** the API defaults to port 4021 and the dashboard to 3021. Other local projects use 3000, 3002, 5000, 7000, 8000 and 5432.
