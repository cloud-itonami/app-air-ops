(ns airops.route
  "Which handler answers a request — as data, decided by a pure function.

  This is `.cljc` and not `.cljs` on purpose. Routing is the part of an edge
  worker that is worth testing, and it is testable here without a browser, a
  build, or a network. `airops.worker` is the only namespace that touches
  Request/Response, and it does nothing this file has not already decided.

  It is also the first thing that should move to `.kotoba` once the ingress
  capability qualifies (`:native-aot`/`:wasm-aot` are pending today —
  ADR-2606290000): a route table is a decision over scalars and strings,
  which is exactly the shape that survives that move."
  (:require [clojure.string :as str]))

(def routes
  "The public surface, as data. The landing page renders THIS, so a route that
  exists and a route the page advertises cannot drift apart — the defect the
  migration removed was a page that said `Routes 0` beside a wrangler.jsonc
  declaring two."
  [{:route/path "/"           :route/method :get  :route/kind :page
    :route/doc "この appview の説明ページ"}
   {:route/path "/health"     :route/method :get  :route/kind :json
    :route/doc "生存確認。デプロイされた面が答えることを外から確かめられる"}
   {:route/path "/xrpc/:nsid" :route/method :post :route/kind :proxy
    :route/doc "XRPC を MCP router へ中継する"}])

(defn- xrpc-nsid
  "`/xrpc/<nsid>` の nsid。**空文字だけが nil**。

  多段パス（`/xrpc/a/b`）も通す。移行前に deploy されていた SvelteKit route は
  rest parameter `[...path]` で受けており、`a/b` をそのまま tool 名として転送
  していた。ここで 1 セグメントに絞ると挙動が変わる —— NSID に `/` は現れない
  ので上流で失敗するだけだが、**それは移行ではなく方針変更**であり、移行の
  commit に紛れ込ませるべきものではない。絞るなら別の決定として記録する。

  同型の移行 5 本（app-lo / app-ongakuka ほか）がすべてこの形になっている。"
  [path]
  (when (str/starts-with? path "/xrpc/")
    (let [rest' (subs path (count "/xrpc/"))]
      (when (seq rest') rest'))))

(defn dispatch
  "method + path → 何をするか。Request も Response も知らない。

  返すのは `{:action …}` で、`:action` は
  `:page` / `:health` / `:xrpc` / `:cors-preflight` / `:not-found` /
  `:method-not-allowed` / `:bad-request` のいずれか。"
  [method path]
  (let [m (keyword (str/lower-case (or method "get")))
        p (or path "")]
    (cond
      (and (= m :options) (str/starts-with? p "/xrpc/"))
      {:action :cors-preflight}

      (str/starts-with? p "/xrpc/")
      (if (= m :post)
        (if-let [nsid (xrpc-nsid p)]
          {:action :xrpc :nsid nsid}
          {:action :bad-request :reason "Missing XRPC method"})
        {:action :method-not-allowed :allow "POST, OPTIONS"})

      (= p "/health") (if (= m :get)
                        {:action :health}
                        {:action :method-not-allowed :allow "GET"})
      (= p "/")       (if (= m :get)
                        {:action :page}
                        {:action :method-not-allowed :allow "GET"})
      :else {:action :not-found})))

(defn mcp-router-url
  "env の設定 → MCP router の URL。末尾スラッシュは落とす。

  既定値をここに焼くのは、設定が無いときに黙って何処かへ POST しないためでは
  なく、**どこへ行くのかを 1 箇所で読めるようにする**ため。呼び出し側は
  この戻り値をそのまま使い、ページにも同じ値を表示する。"
  [{:keys [AGENTGATEWAY_MCP_ROUTER_URL MCP_ROUTER_URL]}]
  (let [pick (fn [s] (when (and (string? s) (seq (str/trim s))) (str/trim s)))]
    (-> (or (pick AGENTGATEWAY_MCP_ROUTER_URL)
            (pick MCP_ROUTER_URL)
            "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message")
        (str/replace #"/+$" ""))))

(defn env-var-keys
  "env の map → ページに出してよいもの＝**キー名だけ**（ソート済み）。

  ここに置いてあるのは、これが判断だからである。worker が `(keys …)` を
  書けば同じ結果になるが、そうすると『値を出さない』という主張を検査できる
  場所がどこにも無くなる —— view は元から値を受け取らないので、view に
  sentinel を当てる検査は**構造的に落ちない**（実測でこれを書きかけた）。
  ここなら「値を返す実装」に変えた瞬間に unit test が赤くなる。"
  [env-map]
  (vec (sort (keys env-map))))

(def ^:private drop-headers
  "上流へ渡さない header。

  `host` —— 移行前の SvelteKit route も削っていた（宛先が変わるので嘘になる）。
  `content-length` / `content-encoding` —— body を JSON-RPC の封筒に詰め直す
  ので、元の長さもエンコーディングも当てはまらない。

  **それ以外は全部渡す。** 移行前は `new Headers(request.headers)` から host を
  削るだけで、`authorization` も上流に届いていた。移行で 3 つの header を新規に
  作る形にしたとき、それが黙って消えていた —— しかも preflight は
  `access-control-allow-headers: content-type,authorization` と許可を宣言した
  ままだったので、ブラウザには送ってよいと言いながら捨てていたことになる。"
  #{"host" "content-length" "content-encoding"})

(defn relay-headers
  "受け取った header を、上流へ渡す形にする。`in` は [[k v] …] の列。

  ここが `.cljc` にあるのは、これがビルドもブラウザも無しに固定できる**判断**
  だからである。`js/Headers` を worker 側で組み立てる形にすると、何が渡って
  何が落ちるかを述べたテストが書けない —— そしてこの欠陥は、まさに誰も
  『何が転送されるか』を訊かなかったから 21 repo で生き延びた。"
  [in nsid]
  (into {"content-type" "application/json"
         "x-etzhayyim-bff" "cljs-worker"
         "x-etzhayyim-xrpc-method" nsid}
        (comp (remove (fn [[k _]] (contains? drop-headers (str/lower-case k))))
              (map (fn [[k v]] [(str/lower-case k) v])))
        in))

(defn unwrap-mcp
  "MCP router の応答から、呼び手に返す値を取り出す。

  `{:result {:structuredContent X}}` → X、`{:result X}` → X、それ以外は素通し。
  `{:error …}` は呼び出し側が 502 にするので、ここでは判定だけ返す。"
  [payload]
  (cond
    (and (map? payload) (contains? payload :error))
    {:ok? false :error (get-in payload [:error :message] "MCP router returned an error")
     :upstream payload}

    (and (map? payload) (contains? payload :result))
    (let [r (:result payload)]
      {:ok? true :value (if (and (map? r) (contains? r :structuredContent))
                          (:structuredContent r)
                          r)})

    :else {:ok? true :value payload}))
