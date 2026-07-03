# Agent-Ready Schema

> An open standard for systems safely operable by autonomous AI agents.

![How an Agent-Ready Schema governs an MCP tool call — risk level and confirmation requirements travel inside the tool description itself, verifiable against real @agent-ready/adapter-mcp output](./assets/architecture.svg)

---

## The problem

APIs were always designed for humans to program against.
The agent is the first consumer that reads, interprets, and decides.

But reading isn't enough.

Today, when an agent integrates a system, the decision of "what it can do on its own" lives in the prompt — scattered, fragile, not reusable, and rebuilt from scratch for every integration.

**Agent-Ready Schema fixes this by putting governance in the system's contract, not in the agent's prompt.**

---

## The inspiration

This project draws on two references:

1. **Felipe Amorim** — ["The A in API No Longer Means Application"](https://felipeamorim.dev/posts/the-a-in-api-no-longer-means-application/)
   > *"Responses need to become signposts. The agent reads. Write for that reader."*

2. **Brazil's NF-e (electronic tax invoice)** — its XSD schema isn't just technical validation. It's governance embedded in the contract. Any system can issue it, any system can validate it, without understanding the semantics from outside.

Agent-Ready Schema generalizes that model to any system operation.

---

## The model

Every operation exposes three layers:

```
1. Operation schema
   → fields, types, validations, context

2. Risk classification
   → FREE | VALIDATED | CONTEXTUAL | CONFIRMATION

3. Response as a signpost
   → what happened + what to do next
```

### Risk levels

| Level | Policy | When to use |
|-------|--------|-------------|
| 🟢 FREE | Executes immediately | Pure read, no state modified |
| 🟡 VALIDATED | Validates before executing | Creates new state |
| 🟠 CONTEXTUAL | Validates state transition | Modifies existing state |
| 🔴 CONFIRMATION | Requires explicit confirmation | Irreversible |

---

## Repository structure

```
agent-ready-core/                      # Monorepo root
│
├── packages/
│   ├── core/                          # @agent-ready/core — runtime engine
│   ├── cli/                           # @agent-ready/cli — ars validate/list/risk/test
│   ├── adapter-sqlite/                # Resolve state guards against SQLite
│   ├── adapter-rest/                  # Resolve predicates via HTTP
│   └── adapter-mcp/                   # Bridge an ARS schema to MCP tools
│
├── apps/
│   ├── docs/                          # Documentation site (Astro Starlight)
│   └── playground/                    # Web schema editor (Svelte)
│
├── docs/
│   ├── spec/
│   │   └── agent-ready-schema-v0.1.md # Formal specification of the standard
│   ├── schemas/familyos/
│   │   ├── financeiro.yml             # Finance module (8 operations)
│   │   └── outros_modulos.yml         # Tasks, Vehicles, Health, Dates, Menu
│   ├── examples/
│   │   └── intents.json               # 10 test intents with expected results
│   └── tests/
│       └── baseline-vs-schema.md      # Baseline vs schema validation template
│
└── README.md
```

---

## Reference implementation: FamilyOS

FamilyOS is a household finance and family management system operated over Telegram, backed by SQLite, Gemini Flash, and Hermes AGT.

It was the first experimental implementation of Agent-Ready Schema.

**18 operations mapped across 6 modules:**

| Module | Operations | Risk mix |
|--------|-----------|----------|
| Finance | 8 | 2×🔴 3×🟡 2×🟠 1×🟢 |
| Tasks | 3 | 2×🟡 1×🟠 |
| Vehicles | 2 | 2×🟡 |
| Health | 2 | 1×🟢 1×🟡 |
| Dates | 1 | 1×🟡 |
| Menu | 2 | 1×🟢 1×🟡 |

The finance module's field and operation names stay in Portuguese (`registrar_gasto`, `deletar_gasto`, ...) — it's a real, working schema pulled straight from FamilyOS, not a translated example. The standard itself is language-agnostic; only this particular reference implementation's domain vocabulary is Portuguese.

---

## Example executable schema

```yaml
- id: OP-FIN-06
  name: deletar_gasto            # "delete expense"
  risk_level: confirmation
  autonomy_policy: require_explicit_confirmation

  input_schema:
    gasto_id:
      type: int
      required: true
    confirmacao:                 # "confirmation"
      type: string
      must_contain: "CONFIRMAR"  # "CONFIRM"

  human_confirmation:
    required: true
    message_template: "This will remove: R${{valor}} from {{categoria}} on {{data}}. Reply CONFIRMAR to proceed."

  signpost:
    pending:
      message_template: "Waiting for confirmation to remove R${{valor}}."
    success:
      next_actions: [consulta_mes]
```

---

## Status

| Component | Status |
|------------|--------|
| Specification v0.1 | ✅ Draft |
| `@agent-ready/core` runtime | ✅ Shipped — 138 tests |
| `@agent-ready/cli` | ✅ Shipped |
| `adapter-sqlite` / `adapter-rest` | ✅ Shipped |
| `adapter-mcp` — MCP bridge | ✅ Shipped |
| FamilyOS schemas | ✅ Complete |
| Test intents | ✅ 10 cases |
| Baseline vs schema validation | ✅ Run — see `docs/tests/baseline-vs-schema.md` (two LLM trials standing in for production Hermes AGT) |
| Docs site / playground | 🔄 Early stage |
| Python validation library | 🗓 Planned |
| Additional reference systems | 🗓 Planned |

---

## Next steps

- [ ] Run baseline-vs-schema validation on FamilyOS
- [ ] Publish results in a technical article
- [ ] Add a Python validation library
- [ ] Add a second reference system beyond FamilyOS
- [ ] Open up for external contributions

---

## References

- Felipe Amorim — [The A in API No Longer Means Application](https://felipeamorim.dev/posts/the-a-in-api-no-longer-means-application/)
- [NF-e — Manual de Orientação ao Contribuinte](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=Rnxas7pDhbY=)
- [MCP — Model Context Protocol](https://modelcontextprotocol.io)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)

---

*Agent-Ready Schema v0.1 — Diego / Orquestra AI — 2026*
*Based on an idea by Felipe Amorim. Structural inspiration: Brazil's NF-e XSD.*
