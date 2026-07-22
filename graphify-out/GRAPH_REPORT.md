# Graph Report - .  (2026-07-19)

## Corpus Check
- Corpus is ~12,820 words - fits in a single context window. You may not need a graph.

## Summary
- 291 nodes · 405 edges · 20 communities (16 shown, 4 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Server and Persistence|Server and Persistence]]
- [[_COMMUNITY_Product and Protocol|Product and Protocol]]
- [[_COMMUNITY_Toolchain Dependencies|Toolchain Dependencies]]
- [[_COMMUNITY_Board Data Service|Board Data Service]]
- [[_COMMUNITY_Build Configuration|Build Configuration]]
- [[_COMMUNITY_Board Interface|Board Interface]]
- [[_COMMUNITY_Noctalia Widget|Noctalia Widget]]
- [[_COMMUNITY_Angular Application Shell|Angular Application Shell]]
- [[_COMMUNITY_Workspace Configuration|Workspace Configuration]]
- [[_COMMUNITY_Runtime Dependencies|Runtime Dependencies]]
- [[_COMMUNITY_SSR Build Options|SSR Build Options]]
- [[_COMMUNITY_Regression Tests|Regression Tests]]
- [[_COMMUNITY_Agent Board CLI|Agent Board CLI]]
- [[_COMMUNITY_Claude Prompt Hook|Claude Prompt Hook]]
- [[_COMMUNITY_Launch Configuration|Launch Configuration]]
- [[_COMMUNITY_Task Configuration|Task Configuration]]
- [[_COMMUNITY_Extension Recommendations|Extension Recommendations]]

## God Nodes (most connected - your core abstractions)
1. `db()` - 21 edges
2. `Board` - 20 edges
3. `now()` - 14 edges
4. `BoardService` - 11 edges
5. `options` - 10 edges
6. `logActivity()` - 9 edges
7. `getTask()` - 9 edges
8. `scripts` - 8 edges
9. `agent-board` - 7 edges
10. `development` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Accessible Responsive Board Polish` --semantically_similar_to--> `Accessible Interaction`  [INFERRED] [semantically similar]
  docs/superpowers/plans/2026-07-18-board-hardening-ui-polish.md → PRODUCT.md
- `Atomic Claim Guarantee` --semantically_similar_to--> `Atomic Task Claim`  [INFERRED] [semantically similar]
  README.md → AGENTS.md
- `Task Status State Machine` --semantically_similar_to--> `Task Coordination Lifecycle`  [INFERRED] [semantically similar]
  README.md → AGENTS.md
- `Streamable HTTP MCP Endpoint` --semantically_similar_to--> `Agent Board MCP Mailbox`  [INFERRED] [semantically similar]
  README.md → AGENTS.md
- `Noctalia Agent Board Widget` --semantically_similar_to--> `Resource-driven Live Board Polling`  [INFERRED] [semantically similar]
  noctalia/agent-board/README.md → README.md

## Hyperedges (group relationships)
- **Agent Coordination Flow** — agents_global_board, agents_task_lifecycle, agents_atomic_claim, readme_agentboard_cli [EXTRACTED 1.00]
- **Board Runtime Architecture** — readme_angular_ssr_server, readme_express_rest_api, readme_sqlite_board_database, readme_live_polling_ui [EXTRACTED 1.00]
- **Hardening Delivery Plan** — plan_lifecycle_integrity, plan_typed_outcomes, plan_visible_mutation_feedback, plan_accessible_ui_polish, plan_verification_gate [EXTRACTED 1.00]

## Communities (20 total, 4 thin omitted)

### Community 0 - "Server and Persistence"
Cohesion: 0.08
Nodes (46): createApiRouter(), STATUSES, db(), loadDatabaseSync(), migrate(), now(), openDatabase(), resolveDbPath() (+38 more)

### Community 1 - "Product and Protocol"
Cohesion: 0.09
Nodes (32): Atomic Task Claim, Agent Coordination Protocol, Global Agent Board, Agent Board MCP Mailbox, Task Coordination Lifecycle, Claude Agent Coordination Protocol, Noctalia Agent Board Widget, Docker Compose Board Control (+24 more)

### Community 2 - "Toolchain Dependencies"
Cohesion: 0.07
Nodes (26): bin, agentboard, devDependencies, @angular/build, @angular/cli, @angular/compiler-cli, jsdom, prettier (+18 more)

### Community 3 - "Board Data Service"
Cohesion: 0.16
Nodes (10): BoardService, params, q, repo, s, Agent, AgentKind, COLUMNS (+2 more)

### Community 4 - "Build Configuration"
Cohesion: 0.11
Nodes (20): architect, build, serve, test, builder, configurations, defaultConfiguration, development (+12 more)

### Community 6 - "Noctalia Widget"
Cohesion: 0.11
Nodes (18): author, boardUrl, composeFile, containerName, dependencies, plugins, description, entryPoints (+10 more)

### Community 7 - "Angular Application Shell"
Cohesion: 0.20
Nodes (7): App, appConfig, config, serverConfig, routes, serverRoutes, fixture

### Community 8 - "Workspace Configuration"
Cohesion: 0.13
Nodes (14): prefix, projectType, root, schematics, sourceRoot, cli, packageManager, newProjectRoot (+6 more)

### Community 9 - "Runtime Dependencies"
Cohesion: 0.14
Nodes (14): dependencies, @angular/common, @angular/compiler, @angular/core, @angular/forms, @angular/platform-browser, @angular/platform-server, @angular/router (+6 more)

### Community 10 - "SSR Build Options"
Cohesion: 0.17
Nodes (12): options, assets, browser, inlineStyleLanguage, outputMode, security, server, ssr (+4 more)

### Community 11 - "Regression Tests"
Cohesion: 0.18
Nodes (10): client, [clientTransport, serverTransport], completed, conflict, invalid, message, reclaimed, result (+2 more)

### Community 12 - "Agent Board CLI"
Cohesion: 0.39
Nodes (6): api(), BASE, die(), main(), parseArgs(), taskLine()

### Community 13 - "Claude Prompt Hook"
Cohesion: 0.43
Nodes (7): BASE, identity(), main(), post(), readStdin(), repoOf(), summarize()

## Knowledge Gaps
- **123 isolated node(s):** `$schema`, `version`, `packageManager`, `newProjectRoot`, `projectType` (+118 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Board` connect `Board Interface` to `Board Data Service`, `Angular Application Shell`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `architect` connect `Build Configuration` to `Workspace Configuration`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `build` connect `Build Configuration` to `SSR Build Options`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `$schema`, `version`, `packageManager` to the rest of the system?**
  _123 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Server and Persistence` be split into smaller, more focused modules?**
  _Cohesion score 0.08311688311688312 - nodes in this community are weakly interconnected._
- **Should `Product and Protocol` be split into smaller, more focused modules?**
  _Cohesion score 0.08669354838709678 - nodes in this community are weakly interconnected._
- **Should `Toolchain Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._