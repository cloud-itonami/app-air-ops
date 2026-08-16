# Operator quickstart — app-air-ops

22 tracked files: flight plan filing, dispatch briefs, NOTAMs, tech logs, fuel orders
and PIREPs for an airline. This is the sixth of the nine `app-air-*` siblings to get a
quickstart, so **the family-wide scaffolding facts are not re-derived here** — they are
in `cloud-itonami/app-air-mro/docs/operator-quickstart.md` §1–§4 and remain true of this
repository field for field (`caps=3 hdr=8 routes=2 vars=8 pageRouteCount=0
healthInSvelte=False todoUnchecked=7`, re-measured 2026-08-16 across all nine).

What this one adds is the layer both `app-air-mro` §6 and `app-air-ffp` §6 recorded as
**NOT WALKED**: `kotoba/`, the only part of the tree that contains domain logic. It is
walked here. The suite is green, **nine of ten mutants die and one survives**, and two
defects show up that no test covers.

Steps marked ✅ were run on 2026-08-16 against `e0be46d`. §9 says what was not walked;
a step that was skipped is not a step that passed.

---

## §0 Four things that will waste your time

`cloud-itonami/app-air-crew/docs/operator-quickstart.md` §0 documents these at length.
Short form, so you need not open it first:

1. **the remote is not `origin`** — west names remotes after the org, so it is
   `cloud-itonami`. `git fetch origin` fails with an access-rights error and
   `origin/main` does not resolve.
2. **`error: could not read IPC response` on stderr is the fsmonitor daemon**, not your
   command; it still succeeded. `-c core.fsmonitor=false` silences it.
3. **`npm install` in `kotoba/` fails** with `EALLOWSCRIPTS` — §2 gets around it.
4. **there is no `.gitignore`** — building in the checkout leaves `node_modules/` and
   `.svelte-kit/` untracked. Everything below builds in `/tmp/ops-build`, a copy, and
   never in the checkout.

```bash
REPO=~/github/com-junkawasaki/orgs/cloud-itonami/app-air-ops
rm -rf /tmp/ops-build && cp -R "$REPO" /tmp/ops-build && rm -rf /tmp/ops-build/.git
```

## §1 ✅ Provenance — is this really a verbatim copy?

`migration.edn` claims an exact extraction:

```clojure
:source {:repository "etzhayyim/root"
         :revision "0c30514ab1ac7f929b1c796f2d03594117fae2d7"
         :path "60-apps/etzhayyim-project-air-ops"
         :tree "16e1d154dbed944665f9a28de3123b7ac441c237"
         :tracked-files 20 :bytes 56970}
:identity {:allowed-additions ["README.edn" "migration.edn"]}
```

`etzhayyim/root` is public, so compare **git blob SHAs** — no file contents need to be
downloaded, and a blob SHA covers every byte:

```bash
cd "$REPO"
gh api "repos/etzhayyim/root/git/trees/16e1d154dbed944665f9a28de3123b7ac441c237?recursive=1" \
  --jq '.tree[] | select(.type=="blob") | .path + " " + .sha' | sort > /tmp/ops-upstream-blobs.txt
git -c core.fsmonitor=false ls-files -s | grep -v -E '(README|migration)\.edn$' \
  | awk '{print $4" "$2}' | sort > /tmp/ops-local-blobs.txt
diff /tmp/ops-upstream-blobs.txt /tmp/ops-local-blobs.txt && echo "20/20 identical"
```

Result: **20 upstream blobs, 20 local blobs, zero differences.** The two additions are
exactly the two declared. The byte count agrees independently:

```bash
git -c core.fsmonitor=false ls-files | grep -v -E '^(README|migration)\.edn$' | xargs wc -c | tail -1
#   56970 total        ← equals :bytes in migration.edn
```

**Confirm the check can fail**, or a clean result means nothing:

```bash
cp kotoba/src/registry.ts /tmp/drift.ts && printf '\n' >> /tmp/drift.ts
git hash-object kotoba/src/registry.ts   # 4c7fde8ad41b344f00e9e111870e5645a560922d — matches upstream
git hash-object /tmp/drift.ts            # 98bc0b76dc4f9ed78b273a671924bf50e278c961 — one newline moves it
```

## §2 ✅ Run the kotoba tests

`kotoba/` is 980 lines (`registry.ts` 414, `types.ts` 394, `test/air-ops.test.ts` 148,
`index.ts` 24) and holds every rule this app has. `npm install` refuses it:

```bash
cd /tmp/ops-build/kotoba && npm install
#   npm error code EALLOWSCRIPTS
#   npm error --allow-scripts is not allowed in project-scoped installs.
```

Both dependencies are git URLs whose preparation runs a nested install that npm 11.16
rejects. The workaround is `app-air-dcs`'s (§6 there); it rests on two facts you can
check yourself. The real SDK is **type-only**, erased at runtime:

```bash
grep -rn '@etzhayyim/sdk' kotoba/src kotoba/test
#   kotoba/src/registry.ts:17:import type { Etzhayyim } from "@etzhayyim/sdk";
#   kotoba/test/air-ops.test.ts:2:import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
```

and the mock is standalone — its two `@etzhayyim/sdk` mentions are both in comments:

```bash
rm -rf /tmp/ops-sdk && mkdir -p /tmp/ops-sdk && cd /tmp/ops-sdk
git clone -q https://github.com/etzhayyim/com-etzhayyim-sdk-mock.git sdk-mock
git -C sdk-mock checkout -q c857ff9be5310bf433bfe1e8d3c0f677e213d667   # the pinned SHA
grep -n '@etzhayyim/sdk' sdk-mock/src/index.ts   # lines 2 and 43, both comments
```

Install the mock from disk with its unused dependency removed:

```bash
node -e 'const fs=require("fs"),f="/tmp/ops-sdk/sdk-mock/package.json";
const p=JSON.parse(fs.readFileSync(f,"utf8"));delete p.dependencies;
fs.writeFileSync(f,JSON.stringify(p,null,2));'

cd /tmp/ops-build/kotoba
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
delete p.dependencies;
p.devDependencies={"@etzhayyim/sdk-mock":"file:/tmp/ops-sdk/sdk-mock","typescript":"^5.6.0","vitest":"^4.1.0"};
fs.writeFileSync("package.json",JSON.stringify(p,null,2));'

npm install --ignore-scripts && npx vitest run
#   Test Files  1 passed (1)
#         Tests  11 passed (11)
```

## §3 ✅ Do the tests discriminate? (ten mutants, one survives)

Eleven green tests prove nothing until you have watched them go red. Each mutation must
be verified to have **applied** — a replace that silently matches nothing produces a
red-free run indistinguishable from a surviving mutant, which is the failure this whole
exercise exists to catch. `apply` exits non-zero before writing when its pattern is
absent, so `run_mut` prints `NO-OP` and leaves the tree untouched. Feed it a string that
does not occur and watch it say so before trusting any row of the table below.

```bash
cd /tmp/ops-build/kotoba
cp src/registry.ts /tmp/ops-registry.orig.ts
cp src/types.ts    /tmp/ops-types.orig.ts

apply () { node - "$1" "$2" "$3" <<'JS'
const fs=require('fs'); const [f,from,to]=process.argv.slice(2);
const p='src/'+f, s=fs.readFileSync(p,'utf8');
if(!s.includes(from)) process.exit(1);          // ← the NO-OP guard
fs.writeFileSync(p, s.replace(from,to));
JS
}

run_mut () {   # run_mut <name> <file> <from> <to>
  cp /tmp/ops-registry.orig.ts src/registry.ts; cp /tmp/ops-types.orig.ts src/types.ts
  apply "$2" "$3" "$4" || { echo "$1 -> NO-OP (pattern not found)"; return; }
  echo "$1 -> $(npx vitest run 2>&1 | grep -E '^ +Tests +' | head -1)"
  cp /tmp/ops-registry.orig.ts src/registry.ts; cp /tmp/ops-types.orig.ts src/types.ts
}
```

| # | mutation | result |
|---|---|---|
| M1 | `recordNotam` dedup: drop the `alreadyExists` return | **1 failed** / 10 passed |
| M2 | `isDecimalString` always accepts | **4 failed** / 7 passed |
| M3 | PIREP → NOTAM-location FK check always true | **1 failed** / 10 passed |
| M4 | `fileFlightPlan` `encryptedWrite` → plaintext `write` | **3 failed** / 8 passed |
| M5 | `recordTechLog` `encryptedWrite` → plaintext `write` | **2 failed** / 9 passed |
| M6 | `listNotams` drops its `location` + `notamType` filters | **1 failed** / 10 passed |
| M7 | `submitPirep` required-field check always accepts | **11 passed — SURVIVED** |
| M8 | `isUint` always accepts | **1 failed** / 10 passed |
| M9 | `coverage` `notamsByLocation` counts 1 instead of accumulating | **1 failed** / 10 passed |
| M10 | `listFuelOrders` drops its `flightNo` filter | **1 failed** / 10 passed |

Ten applied — none reported `NO-OP` — nine killed, **one alive**. Restore and confirm
the baseline is green again, otherwise you have measured a broken tree rather than a
killed mutant:

```bash
cp /tmp/ops-registry.orig.ts src/registry.ts
cp /tmp/ops-types.orig.ts    src/types.ts
npx vitest run          # → Tests  11 passed (11)
```

## §4 ⚠ M7: the PIREP required-field check is untested, and partly hidden

`registry.ts:143` is the whole mutation:

```diff
- if (!input.pirepId || !input.flightNo || !input.location) return { status: "rejected", error: "missingRequiredFields" };
+
```

`recordNotam` has a matching negative test (`notamId: ""` → `rejected`, line 33 of the
suite); `submitPirep` has none. But the reason this hides is more interesting than a
missing case, and it is why reading only the mutant table would mislead you.

Delete the check and submit an empty-identifier PIREP:

```javascript
await recordNotam(e, { notamId: "A1", location: "RJTT", notamType: "RWY", effectiveFrom: "…" });
await submitPirep(e, { pirepId: "", flightNo: "", location: "RJTT" });
// → { status: "submitted",
//     pirepUri: "at://did:web:air-ops.etzhayyim.com/com.etzhayyim.apps.airOps.pirep/pirep-",
//     did: "did:web:air-ops.etzhayyim.com:pirep:", pirepId: "" }
// listPireps(e).total === 1   — an anonymous PIREP, in the store, in the rollup
```

Now submit one with **nothing** anchored:

```javascript
await submitPirep(e, { pirepId: "", flightNo: "", location: "" });
// → { status: "rejected", error: "notamLocationNotFound" }
```

Still rejected — but by the **foreign-key check two lines further down**, under a
different error. So the guard's absence is invisible exactly when the location happens
to be one an operator would actually use. A test that only asserted "empty input is
rejected" would pass against the mutant and prove nothing; the missing test has to
assert the **error code**, and cover a location that exists.

## §5 ⚠ The encrypted path has no duplicate check — and the whole family agrees

M4 and M5 turn `encryptedWrite` into a plaintext `write` and die, so the E2E boundary
itself is tested. What is not tested is what happens when two records land on the same
key. The plaintext writers guard it; the encrypted writers do not:

| path | writers | reads before writing |
|---|---|---|
| plaintext (`recordNotam`, `submitPirep`) | 2 | **2** |
| E2E (`fileFlightPlan`, `createDispatchBrief`, `recordTechLog`, `orderFuel`) | 4 | **0** |

File two different flight plans for the same flight and date:

```javascript
await fileFlightPlan(e, { flightNo:"NH001", depDate:"2026-06-03", origin:"RJTT", dest:"KSFO", captainDid:"did:web:capt.a" });
await fileFlightPlan(e, { flightNo:"NH001", depDate:"2026-06-03", origin:"RJTT", dest:"KLAX", captainDid:"did:web:capt.b" });
// both → { status: "filed", uri: "…/fpl-nh001-2026-06-03" }   (same uri, different keyId)
// listFlightPlans(e).total === 1
// getFlightPlan({flightNo:"NH001", depDate:"2026-06-03"}) → dest KLAX, captain capt.b
```

Both calls report `filed`. The first plan is gone. `MockEtzhayyim` documents this as its
contract — *"Idempotent writes (same collection + rkey) overwrite the previous value"* —
so the caller is told success twice and the store keeps one record.

This is not local to `app-air-ops`. One pass over all nine siblings, splitting each
`registry.ts` into top-level functions and asking whether an `alreadyExists` return
appears **before** the write call:

```bash
cd ~/github/com-junkawasaki/orgs/cloud-itonami && python3 - <<'PY'
import re,glob,os
for d in sorted(glob.glob('app-air-*')):
    f=os.path.join(d,'kotoba','src','registry.ts')
    if not os.path.exists(f): continue
    parts=re.split(r'\n(?=(?:export )?async function )', open(f,encoding='utf-8').read())[1:]
    e2e=e2eg=pt=ptg=0
    for p in parts:
        if 'encryptedWrite' in p:
            e2e+=1; e2eg+= 'alreadyExists' in p[:p.index('encryptedWrite')]
        elif re.search(r'\be\.write\(',p):
            pt+=1;  ptg+= 'alreadyExists' in p[:re.search(r'\be\.write\(',p).start()]
    print(f"{d:16} E2E {e2eg}/{e2e} guarded   plaintext {ptg}/{pt} guarded")
PY
```

```
app-air-cargo    E2E 0/3 guarded   plaintext 2/3 guarded
app-air-crew     E2E 0/7 guarded   plaintext 1/1 guarded
app-air-dcs      E2E 0/3 guarded   plaintext 2/5 guarded
app-air-ffp      E2E 0/2 guarded   plaintext 1/2 guarded
app-air-mro      E2E 0/3 guarded   plaintext 4/4 guarded
app-air-ops      E2E 0/4 guarded   plaintext 2/2 guarded
app-air-sched    E2E 0/0 guarded   plaintext 3/5 guarded
app-air-sms      E2E 0/4 guarded   plaintext 4/4 guarded
app-air-yield    E2E 0/3 guarded   plaintext 2/3 guarded
                 ── 0 of 29 ──                21 of 29 ──
```

**Twenty-nine encrypted writers across nine domain vocabularies, none of them guarded;
twenty-one of twenty-nine plaintext writers guarded.** The same authors, in the same
files, checked one path and not the other — and a collision costs *more* on the
encrypted side, because the plaintext side at least reports `alreadyExists` while the
encrypted side reports `filed` and drops a record. Whether that asymmetry is deliberate
(an OFP reissue legitimately replacing its predecessor) is not written down anywhere in
these repositories; §9 records that as unresolved rather than as a bug.

## §6 ⚠ `rkeyOf` collapses distinct identifiers, and the two paths fail differently

`types.ts:392`:

```typescript
export function rkeyOf(prefix: string, id: string): string {
  return `${prefix}-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
```

Every non-alphanumeric run becomes one `-`, so `A-0001`, `A/0001`, `A 0001` and
`A_0001` are one key. Seven call sites use it (`registry.ts` lines 100, 124, 146, 202,
254, 297, 346), covering every collection. The consequence differs by path.

**Plaintext — wrong record returned.** The dedup guard turns the collision into a
false identity:

```javascript
await recordNotam(e, { notamId:"A-0001", location:"RJTT", notamType:"RWY", … });
await recordNotam(e, { notamId:"A/0001", location:"KSFO", notamType:"NAV", … });
// second → { status: "alreadyExists", notamId: "A/0001", did: "…:notam:a-0001" }
await getNotam(e, { notamId: "A/0001" });
// → { notam: { notamId: "A-0001", location: "RJTT", notamType: "RWY", … } }
```

A dispatcher asking for NOTAM `A/0001` at KSFO is handed a runway notice for RJTT under
someone else's id. Note also that the returned `did` is `…:notam:a-0001` while
`notamDidFor("A/0001")` computes `…:notam:a/0001` — the DID helper only lowercases, so
the DID namespace and the storage-key namespace are not in bijection.

**Encrypted — record lost, lookup says `notFound`.** With no dedup guard (§5):

```javascript
await recordTechLog(e, { techLogId:"T-1", flightNo:"NH001", tailNumber:"JA801A", defectCode:"ATA34", … });
await recordTechLog(e, { techLogId:"T/1", flightNo:"NH002", tailNumber:"JA802A", defectCode:"ATA21", … });
await getTechLog(e, { techLogId: "T-1" });   // → { error: "notFound" }
await getTechLog(e, { techLogId: "T/1" });   // → the JA802A record, at uri …/tlog-t-1
```

The ATA34 defect on JA801A is gone and its own identifier reports `notFound`.

There is a third form specific to the composite keys. `fileFlightPlan` and
`createDispatchBrief` join two fields with a bare `-` **before** normalising, so the
separator is not distinguishable from data:

```javascript
await fileFlightPlan(e, { flightNo:"NH001-2026", depDate:"06-03", … });  // → fpl-nh001-2026-06-03
await fileFlightPlan(e, { flightNo:"NH001",      depDate:"2026-06-03", … });  // → fpl-nh001-2026-06-03
// listFlightPlans(e).total === 1
```

Two different flights, one surviving record, both calls reporting `filed`.

No test in the suite exercises any of this, which is why §3's ten mutants cannot see it:
mutation testing measures whether the tests catch changes to the code, not whether the
code is right about inputs the tests never supply.

## §7 ✅ What is actually deployed

```bash
grep '"main"' wrangler.jsonc
#   "main": "svelte/.svelte-kit/cloudflare/_worker.js"
```

`main` is the SvelteKit build output. `src/app.ts` — 76 lines, the obvious entry point,
opening with `// 8 methods: fileFlightPlan / createDispatchBrief / …`, serving `/health`
and `/_app/meta`, gating on `NSID_PREFIX = "com.etzhayyim.apps.airOps."`, accepting GET
and POST, and forwarding to `dispatcher.etzhayyim.com` — is **not deployed**. Build it
and search the whole unit:

```bash
cd /tmp/ops-build/svelte && npm install --no-audit --no-fund && npm run build
#   ✔ built in 2.78s
find .svelte-kit/cloudflare -type f | wc -l          # 18 files, _worker.js is 4335 bytes
grep -rl 'health'         .svelte-kit/ | wc -l       # 0
grep -rl 'fileFlightPlan' .svelte-kit/ | wc -l       # 0
```

**A search that finds nothing is worthless until you show it can find something.**
Positive controls in the same bundle:

```bash
grep -rl 'sveltekit-edge-bff'         .svelte-kit/ | wc -l   # 1
grep -rl 'AGENTGATEWAY_MCP_ROUTER_URL' .svelte-kit/ | wc -l  # 1
grep -rl 'mcp.etzhayyim.com'           .svelte-kit/ | wc -l  # 1
grep -rl 'structuredContent'           .svelte-kit/ | wc -l  # 1
```

So `/health` genuinely is not there. With `not_found_handling: "none"` in
`wrangler.jsonc`, a GET `/health` on the deployed worker is a 404 — a monitor pointed at
it is watching a path that does not exist.

The deployed handler is `svelte/src/routes/xrpc/[...path]/+server.ts`, ten lines. It
exports **`POST` and `OPTIONS` only** — no GET, unlike `src/app.ts` — takes whatever
NSID is in the path with **no prefix check**, and forwards it to
`AGENTGATEWAY_MCP_ROUTER_URL` as a JSON-RPC `tools/call`. `app-air-mro` §3 covers what
that means for the method list; the short version is that this repository is not where
you learn what the app can do, and `APP_CAPABILITIES` is documentation rather than
enforcement.

## §8 ⚠ Nothing this app declares or calls resolves

```bash
for h in a1r0ps01.etzhayyim.com air-ops.etzhayyim.com mcp.etzhayyim.com dispatcher.etzhayyim.com etzhayyim.com; do
  printf '%-28s %s\n' "$h" "$(dig +short "$h" | tr '\n' ' ')"
done
```

```
a1r0ps01.etzhayyim.com          (none)     ← declared route 1
air-ops.etzhayyim.com           (none)     ← declared route 2
mcp.etzhayyim.com               (none)     ← default upstream of the DEPLOYED handler
dispatcher.etzhayyim.com        (none)     ← default upstream of src/app.ts
etzhayyim.com                   104.21.51.111 172.67.179.128
```

The apex resolves and the zone is on Cloudflare (`everton`/`vivienne.ns.cloudflare.com`),
so this is a real absence and not a broken resolver. `curl https://air-ops.etzhayyim.com/`
returns nothing (`000`). Both declared routes are unrouted, and even if the worker were
deployed, its default upstream has no address — every forwarded call would fail before
reaching an MCP router.

## §9 What could not be walked, and what is unresolved

- **The real `@etzhayyim/sdk` was never loaded.** §2 substitutes the mock, which is
  sound for the tests (the SDK import is type-only) but means every behaviour in §5 and
  §6 is `MockEtzhayyim`'s documented same-key-overwrite semantics, not the substrate's.
  Whether a real PDS overwrites, rejects, or versions a repeated rkey is **unverified
  here**. The collisions themselves (§6) are pure-function facts about `rkeyOf` and hold
  regardless.
- **`npm run typecheck` was not run against the pinned SDK**, for the same reason.
- **Whether E2E overwrite-without-warning is a bug or the intent** is not decided in
  this document. A reissued OFP replacing its predecessor is plausible; four writers
  behaving that way while two neighbours in the same file guard against it, with nothing
  written down either way, is what §5 reports.
- **No fix is proposed for M7.** This pass measured; adding the missing test is a change
  to `kotoba/`, and this repository is a byte-exact extraction (§1) whose upstream is
  `etzhayyim/root` — where the fix belongs is a question for the owner of that tree, not
  for a doc.
- **`MIGRATION-TODO.md`'s seven unticked boxes are not offered as findings.** That file
  says so itself: the TRANSFORM classification came from the app's domain pattern, "not
  on detected violations", and manual review is still required. What is certain is that
  the review has not happened.

## §10 What the maturity instrument sees here ✅

```
· orgs/cloud-itonami/app-air-ops  own=0.049  axis-docs=0bp → +2500bp
    ⚠ README が .md ではないので docs の README 成分は 0（README.edn 等が 1 件）
    ⚠ taxonomy に :repo/kind の行が無い → :default の重みで採点されている
```

Both warnings are about the instrument, not this repository. `README.edn` declares
`:canonical-metadata :edn` — EDN is deliberately canonical here — while the score reads
`README.md`; and with no row in `manifest/repo-taxonomy.edn` the repository is scored
against a guessed weight profile, so its `own` is not comparable to one whose kind is
known. Recorded in ADR-2608052000. Neither is closed by adding a second README, and
adding one to move a number would be the water-weight this loop exists to refuse.

## §11 Leave the checkout clean

Everything above ran in `/tmp/ops-build`, `/tmp/ops-sdk` and a worktree. Nothing was
written to the west checkout; confirm it:

```bash
git -c core.fsmonitor=false -C "$REPO" status --short   # expect: empty
rm -rf /tmp/ops-build /tmp/ops-sdk /tmp/ops-registry.orig.ts /tmp/ops-types.orig.ts
```
