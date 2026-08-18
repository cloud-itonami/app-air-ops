# operator-quickstart — app-air-ops

**この repo で今日実際にできることを、踏める形で上から書く。** 所要 5 分。
Cloudflare のアカウントは要らない（deploy だけが要る。§6）。

出力はすべて 2026-08-18 に実際に walk した結果である。**飛ばしたステップは
合格したステップではない** —— §7 が walk しなかったものを書く。

`kotoba/` の walk（mutation testing・鍵衝突・暗号化パスの欠陥）は
**この文書ではなく `docs/kotoba-layer-audit.md`** にある。移行はあの層に触って
いないので、あちらの測定はいまも成り立つ。

## 0. 前提

| 要るもの | 確認 | この walk で使った版 |
|---|---|---|
| git | `git --version` | 2.51.0 |
| node | `node --version` | v26.3.0 |
| nbb | `npx --yes nbb --version` | v1.4.210 |
| clojure | `clojure --version` | ビルド時のみ（shadow-cljs が呼ぶ） |

**west checkout で作業するなら remote は `origin` ではない。** west は remote を
org 名で作るので `cloud-itonami` である（`git fetch origin` は access-rights
エラーになる。repo が無いのではない）。`error: could not read IPC response` が
stderr に出るのは fsmonitor daemon で、コマンド自体は成功している ——
`-c core.fsmonitor=false` で黙る。

## 1. 取得して、書いてあることが本当か検査する

```bash
git clone git@github.com:cloud-itonami/app-air-ops.git
cd app-air-ops
REPO=$PWD
npx --yes nbb scripts/verify-docs-claims.cljs .
```

実際の出力:

```
SCANNED	26
PASS	tracked-files	expected=26	actual=26
PASS	inherited-bytes	expected=45457	actual=45457
PASS	preserved-files-unchanged	expected=[]	actual=[]
PASS	removed-by-migration-absent	expected=[]	actual=[]
PASS	svelte-artifacts	expected=0	actual=0
PASS	appview-ts-files	expected=0	actual=0
PASS	kotoba-files	expected=7	actual=7
PASS	kotoba-ts-files	expected=5	actual=5
PASS	production-canonical-files	expected=4	actual=4
PASS	wrangler-main	expected="dist/worker.js"	actual="dist/worker.js"
PASS	declared-vars	expected=8	actual=8
PASS	declared-routes	expected=2	actual=2
PASS	app-framework	expected="cljs-esm-worker"	actual="cljs-esm-worker"
PASS	no-stale-assets-binding	expected=true	actual=true
PASS	sveltekit-compat-flags	expected=0	actual=0
PASS	shadow-builds-that-main	expected=true	actual=true
PASS	warnings-as-errors-in-compiler-options	expected=true	actual=true
PASS	page-renders-route-table	expected=true	actual=true
OK	every claim in README.md and docs/ holds
```

末尾が `OK` なら README の数値・存在・不在は tree と一致している。
**exit 2（UNDETERMINED）は 0 ではない** —— tree を読み切れなかったという別の
答えで、「検査して問題なし」と混ぜない。

この検査には移行の不変条件が入っている: appview の TypeScript が戻っていない
こと（撤去した 9 パスの不在 **と** `.ts` の総数の両方）、`kotoba/` が増減して
いないこと（**残すと決めた層なので、消えていないことも検査する**）、
`wrangler.jsonc` の `main` が shadow の出力先を指していること、
`:warnings-as-errors` が `:compiler-options` に在ること、そしてページが route 表
から描かれていること。

### 落ちることを確かめた（6 通り）

緑は、それが赤くなるところを見るまで検査ではない。

| 壊したもの | 赤くなった claim |
|---|---|
| `:warnings-as-errors` を `:build-options` へ移す | `warnings-as-errors-in-compiler-options` |
| `src/app.ts` を元のパスに戻す | `removed-by-migration-absent` + `appview-ts-files` + `tracked-files` |
| **別名**の `.ts`（`src/sneaky.ts`）を足す | `appview-ts-files` + `tracked-files` |
| `kotoba/` にファイルを 1 つ足す | `kotoba-files` + `kotoba-ts-files` + `tracked-files` |
| `wrangler` の `main` を SvelteKit 出力に戻す | `wrangler-main` + `shadow-builds-that-main` |
| `kotoba/src/types.ts` に改行 1 つ足す | `preserved-files-unchanged` + `inherited-bytes` |

`:warnings-as-errors` の置き場所は **EDN を読んで**確かめている。grep では駄目
である —— `shadow-cljs.edn` のコメントにも検証器自身のコメントにもその文字列が
入っているので、grep は必ず当たる（**落ちようのない検査**になる）。

## 2. テストを走らせる（ビルド不要・ブラウザ不要）

判断（`route.cljc`）と描画（`view.cljc`）は純 `.cljc` なので、nbb だけで回る。

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:test:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/run.cljs <<'EOF'
(require '[cljs.test :refer [run-tests]] 'airops.route-test)
(run-tests 'airops.route-test)
EOF
npx --yes nbb --classpath "$CP" /tmp/run.cljs
```

実際の出力:

```
Testing airops.route-test

Ran 6 tests containing 28 assertions.
0 failures, 0 errors.
```

何を固定しているか: `/xrpc/` は**空の nsid だけ** 400 にする（`/xrpc/a/b` も
prefix 無しの NSID も、移行前の rest parameter `[...path]` と同じく転送する ——
絞るのは移行ではなく方針変更）、MCP router の URL 解決（空白だけの設定は未設定
として扱う）、`result` / `structuredContent` の剥がし方、**ページが route 表から
描かれること**（固定値を焼いていたら落ちる）、そして
**env の値がページに出ないこと**。

### 落ちることを確かめた（3 通り）

| 壊したもの | 赤くなったテスト |
|---|---|
| `env-var-keys` が keys でなく **vals** を返す | `env-var-keys-drops-values`（3 assertion） |
| `/xrpc/a/b` を 1 セグメントに絞る | `dispatch-xrpc` |
| ページが route 表でなく空リストを描く | `page-shows-the-real-routes`（2 assertion） |

**値の露出は `view` ではなく `route/env-var-keys` で検査している。** view は元から
値を受け取らないので、view に sentinel を当てる検査は**構造的に落ちない** ——
書きかけて気づいたので、判断を `.cljc` に出した。

## 3. ページを描画して採点する

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/render.cljs <<'EOF'
(require '["node:fs" :as fs] '[airops.view :as view] '[airops.route :as route])
(let [css (.readFileSync fs (str (.-DDS js/process.env) "/resources/jp_go_dds/dds.css") "utf8")]
  (.writeFileSync fs "/tmp/airops-page.html"
    (view/render {:css css :routes route/routes
                  :vars [:AGENTGATEWAY_MCP_ROUTER_URL :APP_CAPABILITIES :APP_DESCRIPTION
                         :APP_DISPLAY_NAME :APP_FRAMEWORK :APP_NANOID
                         :APP_PERFORMER_TYPE :APP_UI_TYPE]
                  :mcp-url "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}))
  (println "wrote /tmp/airops-page.html"))
EOF
DDS="$K/jp-go-digital-design-system" npx --yes nbb --classpath "$CP" /tmp/render.cljs

cd $K/design-quality && npx --yes nbb -m design-quality.cli score /tmp/airops-page.html --min 95
```

実際の出力:

```
  100.00  /tmp/airops-page.html
aggregate: 100.00

axes scored: 10 (viewport, safe-area, dynamic-viewport, tap-targets, focus-visible,
                 reduced-motion, overflow-guard, color-scheme, responsive, semantics)
NOT scored: input-zoom, contrast — pass --extra-axes to include the optional ones
A pass says nothing about an axis that was not applied.
gate: aggregate 100.00 >= min 95.00 -> PASS
```

`--extra-axes` を付けた 12 軸でも `100.00` / PASS。

### この 100.00 が保証しないもの（実測）

**デザインシステムを完全に外しても、この gate は通る。** 同じページを `:css ""`
で描き直して同じ CLI に掛けた:

```
  96.63  /tmp/airops-page-nocss.html
gate: aggregate 96.63 >= min 95.00 -> PASS
```

CSS が 1 バイトも無いページが 96.63 で **PASS** する。CLI 自身が出力に
`A pass says nothing about an axis that was not applied.` と書いている。
「CSS が実際に入っている」と言えるのは §5 の smoke の 2 本目だけである。

## 4. bundle をビルドする

**高負荷ビルドは同時 1 本に制限されている**（superproject `CLAUDE.md` の
resource governor）。直接叩かず、必ず guard 経由で:

```bash
cd "$REPO"
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
  npx --yes shadow-cljs release worker
ls -la dist/worker.js
```

lock を他セッションが持っていると **exit 2** で拒否される。**迂回しない** ——
`resource-guard: build is already running (pid=…)` はエラーではなく順番待ちで
ある（この walk では 1 回目が待ちに入り、2 回目で通った）。

実際の出力（末尾）:

```
[:worker] Build completed. (55 files, 12 compiled, 0 warnings, 31.47s)
-rw-r--r--  1 junkawasaki  wheel  245878  8月 18 21:36 dist/worker.js
```

### 壊れた var はビルドを **落とす**（2026-08-18 実測）

`shadow-cljs.edn` の `:compiler-options` に `:warnings-as-errors true` を入れた。
入れる前は、存在しない var を参照しても shadow は **WARNING** を出して **exit 0**
し、最初のリクエストで `Cannot read properties of undefined` を投げる bundle を
書いていた ——「ビルドが通った」は検査ではなかった（**落ちようがなかった**）。

この repo で実際に落として確かめた。`src/airops/worker.cljs:109` の
`route/dispatch` を、存在しない `route/dispatch-nonexistent` に改名して再ビルド:

```
------ ERROR -------------------------------------------------------------------
 File: /private/tmp/app-air-ops-cljs/src/airops/worker.cljs:109:44
```

| | exit | `dist/worker.js` sha256 | bytes |
|---|---|---|---|
| 改名前 | **0** | `1d064bc7ede21ebb…` | 245878 |
| 改名後 | **1** | `1d064bc7ede21ebb…`（**不変**） | 245878 |
| 戻して再ビルド | **0** | `1d064bc7ede21ebb…` | 245878 |

**落ちたビルドは bundle を出荷しない** —— sha256 が 1 バイトも動いていないことが
それを言っている。戻して再ビルドすると同じ sha に戻ることも確かめた（再現する）。

キーは `:build-options` ではなく **`:compiler-options`** に置く。shadow が読むのは
`[:compiler-options :warnings-as-errors]` で、置き場所を間違えると**黙って無視される**
—— この option が防ぐはずの失敗（落ちようのない検査）そのものになる。

## 5. ビルドした成果物を実際に叩く

ここが deploy されるものに触る唯一の検査である。

```bash
cd "$REPO" && npx --yes nbb scripts/smoke-worker.cljs dist/worker.js
```

実際の出力:

```
PASS	default export has fetch	expected=true	actual=true
PASS	GET / status	expected=200	actual=200
PASS	GET / is html	expected=true	actual=true
PASS	page advertises /health	expected=true	actual=true
PASS	page advertises /xrpc/:nsid	expected=true	actual=true
PASS	page shows a var key	expected=true	actual=true
PASS	page hides other var values	expected=false	actual=false
PASS	page shows the relay target it uses	expected=true	actual=true
PASS	page uses the design system components	expected=true	actual=true
PASS	page carries the stylesheet itself	expected=true	actual=true
PASS	GET /health status	expected=200	actual=200
PASS	health names its routes	expected=true	actual=true
PASS	POST /xrpc/ status	expected=400	actual=400
PASS	OPTIONS preflight	expected=204	actual=204
PASS	unknown path	expected=404	actual=404
PASS	wrong method	expected=405	actual=405
OK	the built bundle answers as the route table says
```

**bundle が無ければ exit 2**（「判定できなかった」であって合格ではない）。
実測:

```
UNDETERMINED	no bundle at /private/tmp/app-air-ops-cljs/dist/worker.js
Refusing to report a pass: build it first (see docs/operator-quickstart.md S4).
exit=2
```

### デザインシステムの検査は 2 本ある（1 本では落ちない）

`dads-table` が在ることを 1 本で見る形は**落ちない検査**だった —— それは view が
出力する markup であって、CSS が 1 バイトも入っていないページにも現れる。
このページで実測:

| 探す文字列 | CSS 込み | CSS 無し |
|---|---|---|
| `dads-table` | 74 | **6**（0 にならない） |
| `class="dads-table"` | 1 | **1** |
| `--color-primitive-blue` | 45 | **0** |
| `--hig-color-secondary-label` | 3 | **3**（app-css が markup に出すので印にならない） |

**割った 2 本が実際に別々に動くことを、ビルドし直して確かめた。**
`(rc/inline "jp_go_dds/dds.css")` を `""` に置き換えて release し直すと:

```
build exit=0            dist/worker.js 245878 → 170538 bytes
...
PASS	page uses the design system components	expected=true	actual=true    ← 緑のまま
FAIL	page carries the stylesheet itself	expected=true	actual=false   ← ここだけ赤
FAILED	1 check(s): page carries the stylesheet itself
smoke exit=1
```

**component 検査は緑のまま、stylesheet 検査だけが赤くなる。**
これが「1 本では落ちなかった」ことの実演であり、2 本に割った理由である。

## 6. Workers ランタイム（workerd）で動かす

Node で import する smoke より強い検査。実際の workerd で起こす。

```bash
cd "$REPO"
npx --yes wrangler@latest dev --local --port 8792 --ip 127.0.0.1
# 別シェルで
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8792/
curl -s http://127.0.0.1:8792/health
```

実際の出力（`compatibility_flags` を**外した**設定で）:

```
200 text/html; charset=utf-8
{"ok":true,"app":"air-ops","runtime":"cljs","routes":["/","/health","/xrpc/:nsid"]}
```

全 route を実際に叩いた:

| リクエスト | 応答 |
|---|---|
| `GET /` | `200 text/html; charset=utf-8` |
| `GET /health` | `200` `{"ok":true,"app":"air-ops","runtime":"cljs","routes":[…]}` |
| `POST /xrpc/` | `400` `{"error":"Missing XRPC method"}` |
| `POST /xrpc/com.etzhayyim.apps.airOps.fetchNotam` | `502` `{"error":"MCP router unreachable","url":"https://mcp.etzhayyim.com/…"}` |
| `POST /xrpc/a/b`（多段） | `502` 同上 —— **単一セグメントと同じ扱い**（移行前と同じ） |
| `OPTIONS /xrpc/x` | `204` |
| `GET /nope` | `404` `{"error":"Not Found","routes":["GET /","GET /health","POST /xrpc/:nsid"]}` |
| `POST /health` | `405` |
| `GET /_app/meta` | `404` —— 未 deploy だった `src/app.ts` の経路。持ち越していない |

**実 env（wrangler.jsonc の 8 vars）に対する値の露出も、ここで測った:**

| 探した文字列 | ページ内の件数 |
|---|---|
| `APP_NANOID`（**キー名**） | 1 |
| `a1r0ps01`（その**値**） | **0** |
| `yoro`（`APP_UI_TYPE` の**値**） | **0** |
| `class="dads-table"` | 1 |
| `--color-primitive-blue`（stylesheet が実際に入っている） | **45** |

`compatibility_flags`（`nodejs_compat` / `nodejs_als`）は SvelteKit の
adapter-cloudflare 由来で、この bundle には要らない。**撤去は憶測ではなく
この実測で確かめてから行った** —— 上の表は flags が無い設定で得たものである。

（`rules` の CompiledWasm については wrangler が
`Add \`fallthrough = true\`…` の警告を出すが、これは継承した設定で、
`.wasm` はこの repo に 1 つも無い。移行の範囲外なので触っていない。）

## 7. deploy（この walk ではやっていない）

```bash
cd "$REPO"
npx wrangler deploy
```

**この walk では実行していない。** そして **route が指すホストは解決しない**:

```
a1r0ps01.etzhayyim.com          (none)     ← 宣言された route 1
air-ops.etzhayyim.com           (none)     ← 宣言された route 2
mcp.etzhayyim.com               (none)     ← /xrpc/:nsid の中継先
dispatcher.etzhayyim.com        (none)     ← 未 deploy だった src/app.ts の中継先
etzhayyim.com                   104.21.51.111 172.67.179.128
```

apex は解決し zone は Cloudflare 上（`everton` / `vivienne.ns.cloudflare.com`）
なので、これは resolver の故障ではなく実在の不在である。deploy が成功しても誰も
到達できない。中継先も同様なので、到達できたとしても `/xrpc/` は **502 を返す**
（成功と同じ形で隠さない）。

superproject の deploy guard は `origin/main` を含む checkout からの deploy しか
許さない点も併せて注意。

## 8. ここに無いもの・walk していないもの

- **`dispatcher.etzhayyim.com` への中継と `/_app/meta`** —— 移行前の `src/app.ts`
  にあり、**どこにも deploy されていなかった**経路。宛先が NXDOMAIN なので
  持ち越していない（README の「持ち越さなかった経路」）。
- **`kotoba/` は移行していない**（消してもいない）。理由と測定は README の
  「`kotoba/` は移していない。消してもいない」、層そのものの walk は
  `docs/kotoba-layer-audit.md`。
- **`kotoba/` の tests はこの walk では回していない。** 2026-08-16 に
  `e0be46d` で回した結果（11 passed、mutant 10 中 1 生存）が audit にある。
  移行は `kotoba/` に 1 バイトも触っていない（sha256 を検証器に固定）ので
  結果は変わらないはずだが、**再実行はしていない**。
- **`MIGRATION-TODO.md` の 7 項目の憲章適合レビュー**は未実施のまま。
- **本番 deploy**（§7）。
