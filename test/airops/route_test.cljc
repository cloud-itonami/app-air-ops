(ns airops.route-test
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.string :as str]
            [airops.route :as route]
            [airops.view :as view]))

(deftest dispatch-page-and-health
  (is (= :page (:action (route/dispatch "GET" "/"))))
  (is (= :health (:action (route/dispatch "GET" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/"))))
  (is (= :not-found (:action (route/dispatch "GET" "/nope"))))
  (testing "移行前に deploy されていなかった src/app.ts の経路は持ち越していない"
    (is (= :not-found (:action (route/dispatch "GET" "/_app/meta"))))))

(deftest dispatch-xrpc
  (testing "単一セグメントの nsid"
    (is (= {:action :xrpc :nsid "com.etzhayyim.apps.airOps.fileFlightPlan"}
           (route/dispatch "POST" "/xrpc/com.etzhayyim.apps.airOps.fileFlightPlan"))))
  (testing "空だけが 400。多段は移行前と同じく転送する（絞るのは方針変更）"
    (is (= :bad-request (:action (route/dispatch "POST" "/xrpc/"))))
    (is (= {:action :xrpc :nsid "a/b"} (route/dispatch "POST" "/xrpc/a/b"))))
  (testing "移行前の +server.ts は prefix を検査しない。ここでも検査しない"
    (is (= {:action :xrpc :nsid "anything.at.all"}
           (route/dispatch "POST" "/xrpc/anything.at.all"))))
  (testing "preflight と method"
    (is (= :cors-preflight (:action (route/dispatch "OPTIONS" "/xrpc/x"))))
    (is (= :method-not-allowed (:action (route/dispatch "GET" "/xrpc/x"))))))

(deftest mcp-url-resolution
  (is (= "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"
         (route/mcp-router-url {})))
  (is (= "https://a.example/x" (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "https://a.example/x/"})))
  (testing "空白だけの設定は未設定として扱う"
    (is (= "https://b.example" (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "   "
                                                      :MCP_ROUTER_URL "https://b.example"})))))

(deftest unwrap
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:structuredContent {:a 1}}})))
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:a 1}})))
  (is (false? (:ok? (route/unwrap-mcp {:error {:message "boom"}})))))

(deftest page-shows-the-real-routes
  (testing "ページは route 表から描く。0 を焼かない（移行前の +page.svelte の欠陥）"
    (let [html (view/render {:css "/*x*/" :routes route/routes
                             :vars [:APP_NANOID :APP_UI_TYPE]
                             :mcp-url "https://mcp.example/x"})]
      (doseq [r route/routes]
        (is (str/includes? html (:route/path r))
            (str (:route/path r) " がページに出ていない")))
      (is (str/includes? html "APP_NANOID"))
      (is (str/includes? html "https://mcp.example/x"))
      (is (not (str/includes? html "No public route is declared"))))))

(deftest env-var-keys-drops-values
  (testing "**2 つの独立した印**で見る。片方だけだと『全部隠す』も『全部出す』も通る"
    (let [env {:APP_NANOID "a1r0ps01"
               :APP_UI_TYPE "SENTINEL-a1r0ps01"
               :AGENTGATEWAY_MCP_ROUTER_URL "https://relay.example.invalid/probe"}
          ks (route/env-var-keys env)
          html (view/render {:css "/*x*/" :routes route/routes :vars ks
                             :mcp-url (route/mcp-router-url env)})]
      (testing "キーは全部出る"
        (is (= [:AGENTGATEWAY_MCP_ROUTER_URL :APP_NANOID :APP_UI_TYPE] ks))
        (is (str/includes? html "APP_NANOID")))
      (testing "出さない側 — env の値はページに現れない"
        ;; env->vars を (vals env) や env そのものに変えるとここが赤くなる。
        (is (not (str/includes? html "SENTINEL-a1r0ps01"))))
      (testing "出す側 — 中継先だけは値そのものが出る"
        ;; 印を .invalid にしてあるので、実 DNS に依存しない。
        (is (str/includes? html "https://relay.example.invalid/probe"))))))

(deftest relay-headers-forwards-what-it-received
  (testing "移行前は host を削るだけで、authorization も上流へ届いていた"
    (let [h (route/relay-headers [["Host" "x.example"]
                                  ["Authorization" "Bearer t"]
                                  ["Content-Length" "9"]
                                  ["Content-Encoding" "gzip"]
                                  ["X-Trace" "abc"]]
                                 "com.a.b")]
      (is (= "Bearer t" (get h "authorization"))
          "authorization が落ちている —— preflight はこれを許可すると言っている")
      (is (= "abc" (get h "x-trace"))
          "呼び手が付けた header が落ちている")
      (is (nil? (get h "host")) "host は宛先が変わるので渡さない")
      (is (nil? (get h "content-length")) "body を詰め直すので元の長さは嘘になる")
      (is (nil? (get h "content-encoding")) "body を詰め直すので元の encoding も嘘になる")
      (is (= "application/json" (get h "content-type")))
      (is (= "com.a.b" (get h "x-etzhayyim-xrpc-method")))
      (is (= "cljs-worker" (get h "x-etzhayyim-bff"))))))
