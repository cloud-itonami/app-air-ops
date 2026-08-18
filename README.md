# app-air-ops

**航空会社の運航管理（air operations / dispatch）の appview。** flight plan filing・
dispatch brief・NOTAM・weather brief・tech log・fuel order・PIREP・flight monitoring
の**公開面**であって、判断そのものはここに無い —— XRPC は MCP router の先へ中継する。

`etzhayyim/root` の `60-apps/etzhayyim-project-air-ops` からの抽出物で、
**2026-08-18 に appview を TypeScript/Svelte から ClojureScript へ移行した**
（docs/adr/0001）。数字はすべて `scripts/verify-docs-claims.cljs` が tree から
再計算して検査する。

## deploy されるものは、いま読んでいるソースである

```
src/airops/route.cljc    判断（どの handler が答えるか・env の何を出すか）  ← 純 .cljc、テスト対象
src/airops/view.cljc     ページ（jp-go-dds の hiccup）                      ← 純 .cljc、テスト対象
src/airops/worker.cljs   Request/Response に触る唯一の層
        ↓ shadow-cljs :target :esm
dist/worker.js           ← wrangler.jsonc の "main" が指すもの
```

移行前は `main` が `svelte/.svelte-kit/cloudflare/_worker.js` を指していた ——
**この tree に 1 バイトも無い SvelteKit のビルド出力**である。読み手が開く
`src/app.ts`（76 行、`// 8 methods: fileFlightPlan / …` で始まる）は
**どの bundle にも入っていなかった**。いまは `main` が指す bundle が上の
ソースからコンパイルされたものなので、その形は構造的に起こり得ない。
`scripts/verify-docs-claims.cljs` が **shadow の出力先と wrangler の `main` と
export の ns 名の 3 つが噛み合っていること**を検査し、噛み合わなくなれば落ちる。

## 公開ルート

| METHOD | PATH | 何をするか |
|---|---|---|
| GET | `/` | この appview の説明ページ |
| GET | `/health` | 生存確認。deploy された面が答えることを外から確かめられる |
| POST | `/xrpc/:nsid` | XRPC を MCP router へ中継する |
| OPTIONS | `/xrpc/*` | CORS preflight |

**この表の出所は `airops.route/routes` で、ページもそこから描く。** 移行前の
`+page.svelte` は `routeCount: 0` / `routes: []` / `vars: []` を literal で持って
おり、隣の `wrangler.jsonc` が route 2・var 8 を宣言していることに気づけず、
『No public route is declared next to this app surface.』と表示していた。いまは
route 表を渡す側が持ち、ページは描くだけなので、両者がずれる余地が無い。

`/health` は移植ではなく**追加**である（移行前に deploy されていた面には無い）。
`/xrpc/` は移行前と同じく **NSID の prefix を検査せず、多段パスも転送する** ——
絞るのは移行ではなく方針変更なので、この commit ではやらない。

## いま在るもの — 26 ファイル

| 面 | ファイル |
|---|---|
| 判断・描画・edge | `src/airops/{route.cljc, view.cljc, worker.cljs}` |
| テスト | `test/airops/route_test.cljc`（6 tests / 28 assertions） |
| ビルド | `deps.edn` / `shadow-cljs.edn` |
| gate | `scripts/{smoke-worker.cljs, verify-docs-claims.cljs}` |
| Worker 設定 | `wrangler.jsonc` |
| actor 記述子 | `kotodama.jsonld` |
| **domain library（移行対象外）** | **`kotoba/` 7 ファイル** —— 下記 |
| 由来・権利・識別 | `NOTICE` / `README.edn` / `migration.edn` / `MIGRATION-TODO.md` |
| 文書 | `README.md` / `docs/operator-quickstart.md` / `docs/kotoba-layer-audit.md` / `docs/adr/*.edn` |

**appview の TypeScript は 0 本、正本言語（`.cljs`/`.cljc`）が 4 本。**
移行前は 3 対 0 だった。この 2 つは検証器の claim なので、TS が戻れば落ちる ——
撤去した 9 パスに戻る場合（`removed-by-migration-absent`）も、別名で入る場合
（`appview-ts-files`）も、別々の claim が捕まえる。

## `kotoba/` は移していない。消してもいない

この repo の TypeScript が全部 appview だったわけではない。`kotoba/`（7 ファイル・
980 行）は air-ops の domain library —— NOTAM / PIREP は平文、flight plan・
dispatch brief・tech log・fuel order は kotoba E2E で封をする、という規則を
持っている。次の 3 点を**測った上で**手を触れていない:

| 判定材料 | 測定 |
|---|---|
| どの bundle にも入っていない | 移行後の `dist/worker.js` に `fileFlightPlan` / `recordNotam` / `rkeyOf` / `encryptedWrite` が **0 件**（同じ bundle で `dads-table` が 73 件 = 陽性対照）。移行前の SvelteKit bundle でも同様に 0 件（docs/kotoba-layer-audit.md §7） |
| 移行対象から参照されていない | tree 全体の grep で `kotoba/` の外に参照は無い |
| 依存が解決する | pin された 2 つの git dep は `git fetch <url> <sha>` がどちらも `type=commit` を返す（`12314a0c…` / `c857ff9b…`） |

**在庫の大半を『TypeScript だから』で消すのは移行ではなく破壊である。** 残した上で、
**ファイル数（7）と全バイトの sha256 を検証器に固定した**ので、黙って増減しない。
移行するなら別の決定で、依存先（`@etzhayyim/sdk`）に cljs の面が要る。

この層は 2026-08-16 に別途 walk 済みで、**テストは緑だが 10 個の mutant のうち
1 個が生き残り**、テストが 1 つも見ていない欠陥が 2 つある（`rkeyOf` の鍵衝突、
暗号化パスに重複検査が無い）。移行はそれを直さない。→ `docs/kotoba-layer-audit.md`

## ページが出す値・出さない値

env の**キー名**は出すが、値は出さない —— **中継先を除いて**。
`AGENTGATEWAY_MCP_ROUTER_URL` の値だけは、どこへ中継するかを運用者が見る
必要があるので意図的に表示する。

検査は**2 つの独立した印**で見る: sentinel が出ていないこと、そして中継先の値が
在ること。片方だけだと「全部隠す」実装も「全部出す」実装も通ってしまう。
この判断は view ではなく `route/env-var-keys` に置いてある —— view は元から値を
受け取らないので、**view に sentinel を当てる検査は構造的に落ちない**（実際に
書きかけた）。

## UI

基盤は `kotoba-lang/jp-go-digital-design-system`（デジタル庁デザインシステム）。
色・寸法は `--hig-*` トークン契約だけで書き、raw hex も px フォントサイズも
置かない。app 固有 CSS は 3 行。CSS は外部リクエストゼロの方針どおり
`shadow.resource/inline` で bundle に焼く。

決定論的 audit（`kotoba-lang/design-quality`）で **100.00 / 100（gate 95）**。
`--extra-axes` を付けた 12 軸でも 100.00。

### デザインシステムの検査は 2 本ある

`dads-table` が在ることを 1 本で見る形は**落ちない検査**だった —— それは view が
出力する markup であって、CSS が 1 バイトも入っていないページにも現れる。
このページで実測（2026-08-18）:

| 探す文字列 | CSS 込み | CSS 無し |
|---|---|---|
| `dads-table` | 74 | **6**（0 にならない） |
| `class="dads-table"` | 1 | **1** |
| `--color-primitive-blue` | 45 | **0** |
| `--hig-color-secondary-label` | 3 | **3**（app-css が markup に出すので印にならない） |

だから 2 本に割った。**component を使ったか**と **stylesheet が実際に入ったか**は
別の主張である。CSS を外してビルドし直すと後者だけが赤くなることを確認済み。

**design-quality のスコアはこの区別をしない。** デザインシステムを完全に外した
ページを同じ CLI に掛けると **96.63 で PASS する**（gate 95）。CLI 自身が
`axes scored: 10 … A pass says nothing about an axis that was not applied.` と
出力に書く。「CSS が実際に入っている」と言えるのは smoke の 2 本目だけ。

## ビルドが通ることは、それ自体では検査ではない

shadow は未宣言・改名された var を **WARNING** として扱い **exit 0** する ——
最初のリクエストで throw する bundle を書きながら「ビルド成功」と言う。
`shadow-cljs.edn` の **`:compiler-options`**（`:build-options` ではない —— そこに
置くと黙って無視され、この option が防ぐはずの失敗そのものになる）に
`:warnings-as-errors true` を入れ、実際に落として確かめた。
検証器はこの置き場所を **EDN を読んで**確かめる（grep では駄目 —— コメントにも
検証器自身にもその文字列が入っているので必ず当たる）。

## 呼び先が 1 つも解決しない（移行では直らない）

| ホスト | 役割 | DNS |
|---|---|---|
| `air-ops.etzhayyim.com` | 公開ホスト（wrangler の route） | **NXDOMAIN** |
| `a1r0ps01.etzhayyim.com` | 同（nanoid 側） | **NXDOMAIN** |
| `mcp.etzhayyim.com` | `/xrpc/:nsid` の中継先 | **NXDOMAIN** |
| `dispatcher.etzhayyim.com` | 未 deploy の `src/app.ts` の中継先 | **NXDOMAIN** |

apex `etzhayyim.com` は `104.21.51.111` / `172.67.179.128` を返し zone は
Cloudflare 上にあるので、これは resolver の故障ではなく実在の不在である。
deploy 先も中継先も、いま存在しない。`/xrpc/` は到達できなければ **502 を返す**
—— 成功と同じ形で隠さない。

## 由来（custody）

`migration.edn` は出所を `etzhayyim/root` の tree `16e1d154` と宣言し、
`:identity {:allowed-additions ["README.edn" "migration.edn"]}` を持つ。
**移行はこの 2 件をはるかに超えてファイルを足し引きした** ので、
`:allowed-additions` は 2026-05-21 の抽出時点の宣言としてそのまま残し、
現在地はここと検証器が持つ:

- 継承した 12 ファイル（45,457 バイト）は**いまも 1 バイトも変わっていない**
  （sha256 を検証器に固定）。うち 7 つは `kotoba/`
- `wrangler.jsonc` は**意図的に変更**した（`main` の付け替え、この tree に無い
  SvelteKit client を指す `assets` の撤去、`compatibility_flags` の撤去、
  `APP_FRAMEWORK` の更新）
- appview の TypeScript/Svelte **9 ファイルは移行で撤去**した。検証器はその
  9 パスを名指しで「不在であること」を検査する —— byte 合計は「TS が消えた」と
  言えない

## 残っている欠陥（移行では直っていない）

1. **deploy 先も中継先も NXDOMAIN**（上記）。移行はそれを直さない。
2. **`kotoba/` の mutant が 1 つ生き残る**（`submitPirep` の必須項目検査に
   テストが無い）。`rkeyOf` の鍵衝突と暗号化パスの重複検査欠如も、テストは
   1 つも見ていない。→ `docs/kotoba-layer-audit.md`
3. **`MIGRATION-TODO.md` のチェックボックス 7 件が未チェック**のまま。憲章適合の
   手動レビューは未実施であると文書自身が書いている。

## 検証

```bash
npx --yes nbb scripts/verify-docs-claims.cljs .     # <dir> は先頭に置く
```

exit 0 = 全一致 / 1 = 食い違い / **2 = 判定できなかった**（0 と区別する）。
テスト・ビルド・smoke は `docs/operator-quickstart.md`。
