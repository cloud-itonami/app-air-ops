#!/usr/bin/env nbb
;; verify-docs-claims — re-derive every number README.md and docs/*.md state, from
;; the tree itself, and fail when the tree and the prose disagree.
;;
;; Before the cljs migration this file's load-bearing claim would have been a GAP:
;; the Worker that would be deployed was a SvelteKit build output ABSENT FROM THIS
;; TREE, while src/app.ts -- the file that read like the application -- was in no
;; bundle at all. That gap is closed, so the claims assert the CLOSURE, and they are
;; written so it cannot quietly come back: the appview TypeScript is asserted ABSENT
;; BY NAME, not merely absent from a byte total.
;;
;; It also pins what the migration deliberately did NOT touch. `kotoba/` is a
;; TypeScript domain library that is in no bundle, referenced by nothing the
;; migration replaced, and whose two pinned git dependencies resolve -- so it is
;; not dead code and was not the appview's to delete. Its file count and every
;; byte of it are pinned here so it cannot grow, shrink, or drift silently.
;;
;; Usage:  nbb scripts/verify-docs-claims.cljs [<dir>]     (<dir> FIRST, default ".")
;; Exit:   0 every claim holds · 1 a claim is false · 2 could not answer

(require '["node:fs" :as fs]
         '["node:child_process" :as cp]
         '["node:crypto" :as crypto]
         '[clojure.string :as str])

(def root (or (first (remove #(str/starts-with? % "--") *command-line-args*)) "."))

(def claims
  {:tracked-files 26
   :inherited-bytes 45457          ; the 12 inherited files still carried unchanged
   :svelte-artifacts 0             ; no .svelte / svelte.config / svelte-dir file survives
   :sveltekit-compat-flags 0       ; nodejs_compat / nodejs_als were adapter-cloudflare's
   :appview-ts-files 0             ; TypeScript OUTSIDE kotoba/ -- the appview's
   :kotoba-files 7                 ; the domain library kept ON PURPOSE, pinned so it cannot grow
   :kotoba-ts-files 5
   :production-canonical-files 4
   :declared-vars 8
   :declared-routes 2
   :app-framework "cljs-esm-worker"
   :wrangler-main "dist/worker.js"
   :shadow-output-dir "dist"
   :shadow-export "airops.worker/handler"})

;; Inherited files this repository still carries BYTE-IDENTICAL. wrangler.jsonc and
;; docs/operator-quickstart.md left this set deliberately in the migration and are
;; checked by content below instead of by hash -- so that an intentional change and
;; an accidental one stay distinguishable.
;;
;; The seven kotoba/ entries are the "keep it, and pin it" half of the scope
;; decision: the migration did not touch the domain library, and this map is what
;; makes that statement checkable rather than a promise.
(def preserved
  {"MIGRATION-TODO.md"          "ad8166f571b5ac00f48ed4da28296df33d31350d22544d8e0f657afd843f70be"
   "NOTICE"                     "9d3bd5678f857c647a465987cd8538580215416648991fd9de47e6dc648544f0"
   "README.edn"                 "c43b590720eb4ce4c7f4aad0209a1621b84eb50b5df13faace4037f164d3d76d"
   "migration.edn"              "0f7fcaef8ac675b020a23b9ef9ec095e906c4d77d73e9e6956d1df8039d19c59"
   "kotodama.jsonld"            "1cc88bf63e54b9e70e8c2105301a3b1354831222341739de3b3a20d0e69c074b"
   "kotoba/package.json"        "af7920e8cd902a4accc9f9fbcd946b930f2ad5e3b523e657268ee62d4ac25fac"
   "kotoba/src/index.ts"        "8b2ead23b2bb343aaf6d98ea2c0bc74847646660c48bd551c0ca089375a90f4c"
   "kotoba/src/registry.ts"     "9a4d8bdc3a5e004452c836c2ae5f9523d4b4cece6b4da466fb93ef01a3a20539"
   "kotoba/src/types.ts"        "d160a369d8fe20a3f3fcf241ca3d0c211c960caf6ec8039b0dee2e230a2a9763"
   "kotoba/test/air-ops.test.ts" "f2824e58127e1a135c4fc3463c4a2c5f0dc0bf1e1efae39e6f405a0ea7b47c25"
   "kotoba/tsconfig.json"       "95a429e51d6162cb7205b603f745e7604d93ffbb1ea6c346e5c6215a79ae541e"
   "kotoba/vitest.config.ts"    "f82a551ef4da1c9cbf17985a3bee96eee450a3e4a46bff0d96c6150263121eff"})

;; What the migration REMOVED, by name. A byte total cannot say "the appview
;; TypeScript is gone"; this can, and it fails if any of it comes back.
(def removed-by-migration
  ["src/app.ts"
   "package.json"                                  ; the appview's tsc --noEmit shell
   "svelte/package.json"
   "svelte/src/app.html"
   "svelte/src/routes/+page.svelte"
   "svelte/src/routes/xrpc/[...path]/+server.ts"
   "svelte/svelte.config.js"
   "svelte/tsconfig.json"
   "svelte/vite.config.ts"])

(def undetermined (atom []))
(def failures (atom []))
(defn undet! [m] (swap! undetermined conj m))

(defn tracked-files []
  (try (->> (.execSync cp "git ls-files" #js {:cwd root :encoding "utf8"})
            str/split-lines (remove str/blank?) vec)
       (catch :default e (undet! (str "git ls-files failed: " (.-message e))) nil)))
(defn slurp* [rel] (try (.readFileSync fs (str root "/" rel) "utf8") (catch :default _ nil)))
(defn bytes-of [rel] (try (.-size (.statSync fs (str root "/" rel))) (catch :default _ nil)))
(defn sha256 [rel]
  (try (-> (.createHash crypto "sha256") (.update (.readFileSync fs (str root "/" rel))) (.digest "hex"))
       (catch :default _ nil)))
(defn strip-jsonc [s] (str/replace s #"(?m)^\s*//.*$" ""))

(defn check! [label expected actual]
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" (name label)
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))
    ok))

(let [files (tracked-files)]
  (when (nil? files) (println "UNDETERMINED\tcould not list tracked files") (js/process.exit 2))
  (println (str "SCANNED\t" (count files)))
  (when (zero? (count files)) (println "UNDETERMINED\tscanned 0 files") (js/process.exit 2))

  (let [sizes (into {} (map (juxt identity bytes-of)) files)]
    (when-let [bad (seq (keep (fn [[f s]] (when (nil? s) f)) sizes))]
      (undet! (str "tracked but unreadable: " (str/join ", " bad))))

    (check! :tracked-files (:tracked-files claims) (count files))
    (check! :inherited-bytes (:inherited-bytes claims)
            (reduce + 0 (keep #(get sizes %) (keys preserved))))
    (check! :preserved-files-unchanged []
            (vec (keep (fn [[f want]] (let [got (sha256 f)]
                                        (when-not (= want got) (str f " " (or got "MISSING")))))
                       preserved)))

    ;; the appview TypeScript is gone, by name
    (check! :removed-by-migration-absent []
            (vec (filter #(some? (bytes-of %)) removed-by-migration)))

    ;; Svelte is gone and must not come back. removed-by-migration names the seven
    ;; svelte/ files; these catch a return under ANY name -- a new .svelte file, a
    ;; svelte.config, or a svelte/ directory.
    (check! :svelte-artifacts (:svelte-artifacts claims)
            (count (filter #(or (str/ends-with? % ".svelte")
                                (str/includes? % "svelte.config")
                                (str/includes? % "/svelte/")
                                (str/starts-with? % "svelte/"))
                           files)))

    ;; Language of the source, split by WHOSE source it is. The appview is
    ;; ClojureScript; kotoba/ is TypeScript and stayed that way on purpose. One
    ;; number for each, so "the appview is migrated" and "the library was left
    ;; alone" are two claims that can fail independently.
    (let [prod (remove #(str/starts-with? % "scripts/") files)
          kotoba (filter #(str/starts-with? % "kotoba/") files)]
      (check! :appview-ts-files (:appview-ts-files claims)
              (count (filter #(and (str/ends-with? % ".ts")
                                   (not (str/starts-with? % "kotoba/")))
                             prod)))
      (check! :kotoba-files (:kotoba-files claims) (count kotoba))
      (check! :kotoba-ts-files (:kotoba-ts-files claims)
              (count (filter #(str/ends-with? % ".ts") kotoba)))
      (check! :production-canonical-files (:production-canonical-files claims)
              (count (filter #(re-find #"\.(cljs|cljc|clj|kotoba)$" %) prod))))

    ;; the deployed bundle is built from the source in this tree
    (let [w (some-> (slurp* "wrangler.jsonc") strip-jsonc)
          sh (slurp* "shadow-cljs.edn")]
      (if (or (nil? w) (nil? sh))
        (undet! "wrangler.jsonc or shadow-cljs.edn unreadable")
        (let [j (js->clj (.parse js/JSON w) :keywordize-keys false)]
          (check! :wrangler-main (:wrangler-main claims) (get j "main"))
          (check! :declared-vars (:declared-vars claims) (count (get j "vars")))
          (check! :declared-routes (:declared-routes claims) (count (get j "routes")))
          (check! :app-framework (:app-framework claims) (get-in j ["vars" "APP_FRAMEWORK"]))
          ;; the old config served a SvelteKit client dir that is not in this tree
          (check! :no-stale-assets-binding true (nil? (get j "assets")))
          (check! :sveltekit-compat-flags (:sveltekit-compat-flags claims)
                  (count (filter #{"nodejs_compat" "nodejs_als"}
                                 (or (get j "compatibility_flags") []))))
          (check! :shadow-builds-that-main true
                  (and (str/includes? sh (str ":output-dir \"" (:shadow-output-dir claims) "\""))
                       (str/includes? sh (:shadow-export claims))
                       (str/includes? (get j "main") (str (:shadow-output-dir claims) "/worker.js"))))
          ;; :warnings-as-errors must sit under :compiler-options. Read the EDN --
          ;; grepping for the string is not a check, because the comment above it
          ;; in shadow-cljs.edn contains the string too (and so does this file).
          (check! :warnings-as-errors-in-compiler-options true
                  (try (true? (get-in (cljs.reader/read-string sh)
                                      [:builds :worker :compiler-options :warnings-as-errors]))
                       (catch :default e (undet! (str "shadow-cljs.edn unreadable as EDN: "
                                                      (.-message e)))
                              nil))))))

    ;; The page renders the route TABLE rather than a baked count -- the defect the
    ;; migration removed was a literal `routeCount: 0` in +page.svelte beside a
    ;; wrangler.jsonc declaring two. Asserted structurally (the view takes :routes,
    ;; the worker passes the real table) and NOT by forbidding a substring: a check
    ;; that a docstring explaining the old defect can trip is a check about prose.
    (let [v (slurp* "src/airops/view.cljc")
          w (slurp* "src/airops/worker.cljs")]
      (if (or (nil? v) (nil? w))
        (undet! "view.cljc or worker.cljs unreadable")
        (check! :page-renders-route-table true
                (and (str/includes? v "[{:keys [routes vars mcp-url built-at]}]")
                     (str/includes? v "(route-rows routes)")
                     (str/includes? w ":routes route/routes")))))))

(let [u @undetermined f @failures]
  (when (seq u)
    (doseq [m u] (println (str "UNDETERMINED\t" m)))
    (println "Refusing to report a pass: the tree could not be read completely.")
    (js/process.exit 2))
  (if (seq f)
    (do (println (str "FAILED\t" (count f) " claim(s): " (str/join ", " (map name f)))) (js/process.exit 1))
    (do (println "OK\tevery claim in README.md and docs/ holds") (js/process.exit 0))))
