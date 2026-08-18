(ns airops.view
  "この appview の説明ページ。純 hiccup。

  基盤は `jp-go-dds`(デジタル庁デザインシステム) —— superproject の
  skill `kotoba-uiux` が定める新規 UI の base。色・寸法は `--hig-*` トークン
  契約で書き、raw hex も px フォントサイズも置かない。

  **表示する事実は引数で受け取る。ページの中に焼かない。**
  これは装飾の都合ではなく、この移行が消しにきた欠陥そのものへの答えである
  —— 移行前のページ（`svelte/src/routes/+page.svelte`）は `routeCount: 0` と
  `vars: []` と `routes: []` を literal で持っていて、隣の wrangler.jsonc が
  route 2・var 8 を宣言していることに気づけなかった。ここでは route 表と設定を
  渡す側が持ち、ページは描くだけなので、両者がずれる余地が無い。"
  (:require [jp-go-dds.core :as dds]
            [jp-go-dds.page :as page]
            [jp-go-dds.tokens :as tokens]
            [clojure.string :as str]))

(def app-css
  "app 固有の最小 CSS。`--hig-*` 契約だけを使う(bridge が DADS の上に再定義する)。
  DADS を base にした app の下には `shitsuke.hig` が居ないので、bridge が運んで
  いないトークンは何にも解決しない —— 使うのは運ばれている 71 個の中だけ。"
  (str/join
   "\n"
   [".ops-lede { color: var(--hig-color-secondary-label); max-width: 42rem; }"
    ".ops-note { color: var(--hig-color-secondary-label); font-size: var(--hig-text-footnote-font-size); }"
    ".ops-mono { font-family: var(--hig-font-mono); }"]))

(defn- route-rows [routes]
  (mapv (fn [r]
          [(str/upper-case (name (:route/method r)))
           [:span {:class "ops-mono"} (:route/path r)]
           (:route/doc r)])
        routes))

(defn body
  "opts:
   :routes    airops.route/routes（この Worker が実際に答えるもの）
   :vars      wrangler が渡した env のキー（**キー名だけ**。値は出さない）
   :mcp-url   XRPC の中継先（route/mcp-router-url の戻り値。**値そのもの**）
   :built-at  bundle のビルド時刻（不明なら nil）"
  [{:keys [routes vars mcp-url built-at]}]
  (dds/container
   (dds/section
    {}
    (dds/heading 1 "Air Flight Operations")
    [:p {:class "ops-lede"}
     "航空会社の運航管理（flight plan filing・dispatch brief・NOTAM・"
     "weather brief・tech log・fuel order・PIREP・flight monitoring）の"
     "公開面。判断そのものは MCP router の先にあり、ここには無い。"])

   (dds/section
    {:title "この面が答えるもの"}
    (dds/table {:caption "公開ルート"
                :headers ["METHOD" "PATH" "何をするか"]
                :rows (route-rows routes)})
    [:p {:class "ops-note"}
     "この表は Worker の route 表そのものから描いている。ページに焼いた値では"
     "ないので、実際に答えるものと表示がずれない。"])

   (dds/section
    {:title "実行時の設定"}
    (if (seq vars)
      [:div (into [:p] (interpose " "
                                  (map (fn [k] (dds/chip-label (name k))) vars)))
       [:p {:class "ops-note"}
        "キー名のみ。**ただし下の中継先だけは値そのもの**（"
        [:span {:class "ops-mono"} "AGENTGATEWAY_MCP_ROUTER_URL"]
        "）—— どこへ中継するかは運用者が見る必要があるので意図的に出している。"
        "それ以外の値は出さない。"]]
      [:p {:class "ops-note"} "env が渡されていない（ローカル描画）。"])
    [:p {:class "ops-note"} "XRPC の中継先: "
     [:span {:class "ops-mono"} mcp-url]])

   (dds/section
    {:title "現在地"}
    [:p {:class "ops-lede"}
     "この appview は TypeScript/Svelte から ClojureScript へ移行済み。"
     "deploy される bundle は、いま読んでいるソースからコンパイルされたもので"
     "ある（docs/adr/0001）。"]
    [:p {:class "ops-note"}
     "この repo の "
     [:span {:class "ops-mono"} "kotoba/"]
     " は移行の対象外。どの bundle にも入らない TypeScript の domain library で、"
     "依存も解決するので削っていない（docs/kotoba-layer-audit.md）。"]
    (when built-at
      [:p {:class "ops-note"} "bundle build: " built-at]))))

(defn render
  "完全な HTML 文書。`css` は呼び出し側が渡す(ライブラリは I/O を持たない)。"
  [{:keys [css] :as opts}]
  (page/->page
   {:title "Air Flight Operations"
    :description "航空会社の運航管理 appview の公開面（flight plan・dispatch brief・NOTAM ほか）。"
    :lang "ja"
    :css css
    :app-css (str tokens/bridge-css "\n" app-css)}
   (body opts)))
