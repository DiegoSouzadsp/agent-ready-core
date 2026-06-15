# Agent-Ready Schema

> Um padrão aberto para sistemas operáveis por agentes com autonomia segura.

---

## O problema

APIs foram sempre projetadas para humanos programarem.
O agente é o primeiro consumidor que lê, interpreta e decide.

Mas leitura não é suficiente.

Hoje, quando um agente integra um sistema, a decisão de "o que pode fazer sozinho" vive no prompt — espalhada, frágil, não reutilizável, e refeita do zero a cada integração.

**Agent-Ready Schema resolve isso colocando a governança no contrato do sistema, não no prompt do agente.**

---

## A inspiração

Este projeto parte de duas referências:

1. **Felipe Amorim** — ["The A in API No Longer Means Application"](https://felipeamorim.dev/posts/the-a-in-api-no-longer-means-application/)
   > *"Responses precisam virar signposts. O agente lê. Escreva para esse leitor."*

2. **NF-e brasileira** — O schema XSD não é só validação técnica. É governança embutida no contrato. Qualquer sistema emite, qualquer sistema valida, sem entender a semântica por fora.

Agent-Ready Schema generaliza esse modelo para qualquer operação de sistema.

---

## O modelo

Cada operação expõe três camadas:

```
1. Esquema de operação
   → campos, tipos, validações, contexto

2. Classificação de risco
   → FREE | VALIDATED | CONTEXTUAL | CONFIRMATION

3. Resposta como signpost
   → o que aconteceu + o que fazer a seguir
```

### Níveis de risco

| Nível | Política | Quando usar |
|-------|----------|-------------|
| 🟢 FREE | Executa imediatamente | Leitura pura, nenhum estado modificado |
| 🟡 VALIDATED | Valida antes de executar | Cria estado novo |
| 🟠 CONTEXTUAL | Valida transição de estado | Modifica estado existente |
| 🔴 CONFIRMATION | Exige confirmação explícita | Irreversível |

---

## Estrutura do repositório

```
agent-ready-schema/
│
├── spec/
│   └── agent-ready-schema-v0.1.md     # Especificação formal do padrão
│
├── schemas/
│   └── familyos/
│       ├── financeiro.yml             # Módulo financeiro (8 operações)
│       └── outros_modulos.yml         # Tarefas, Veículos, Saúde, Datas, Cardápio
│
├── examples/
│   └── intents.json                   # 10 intents de teste com resultados esperados
│
├── tests/
│   └── baseline-vs-schema.md          # Template de validação Baseline vs Schema
│
└── README.md
```

---

## Implementação de referência: FamilyOS

FamilyOS é um sistema doméstico de gestão financeira e familiar operado via Telegram, com SQLite, Gemini Flash e Hermes AGT.

Foi a primeira implementação experimental do Agent-Ready Schema.

**18 operações mapeadas em 6 módulos:**

| Módulo | Operações | Riscos |
|--------|-----------|--------|
| Financeiro | 8 | 2×🔴 3×🟡 2×🟠 1×🟢 |
| Tarefas | 3 | 2×🟡 1×🟠 |
| Veículos | 2 | 2×🟡 |
| Saúde | 2 | 1×🟢 1×🟡 |
| Datas | 1 | 1×🟡 |
| Cardápio | 2 | 1×🟢 1×🟡 |

---

## Exemplo de schema executável

```yaml
- id: OP-FIN-06
  name: deletar_gasto
  risk_level: confirmation
  autonomy_policy: require_explicit_confirmation

  input_schema:
    gasto_id:
      type: int
      required: true
    confirmacao:
      type: string
      must_contain: "CONFIRMAR"

  human_confirmation:
    required: true
    message_template: "Isso vai remover: R${{valor}} em {{categoria}} em {{data}}. Responda CONFIRMAR para prosseguir."

  signpost:
    pending:
      message_template: "Aguardando confirmação para remover R${{valor}}."
    success:
      next_actions: [consulta_mes]
```

---

## Status

| Componente | Status |
|------------|--------|
| Especificação v0.1 | ✅ Draft |
| Schemas FamilyOS | ✅ Completo |
| Intents de teste | ✅ 10 casos |
| Validação baseline vs schema | 🔄 Em andamento |
| Biblioteca de validação Python/JS | 🗓 Planejado |
| Mais sistemas de referência | 🗓 Planejado |

---

## Próximos passos

- [ ] Executar validação baseline vs schema no FamilyOS
- [ ] Publicar resultados em artigo técnico
- [ ] Implementar biblioteca de validação (Python primeiro)
- [ ] Adicionar segundo sistema de referência (Orquestra AI / EVOT Ecosystem)
- [ ] Abrir para contribuições externas

---

## Referências

- Felipe Amorim — [The A in API No Longer Means Application](https://felipeamorim.dev/posts/the-a-in-api-no-longer-means-application/)
- [NF-e — Manual de Orientação ao Contribuinte](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=Rnxas7pDhbY=)
- [MCP — Model Context Protocol](https://modelcontextprotocol.io)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)

---

*Agent-Ready Schema v0.1 — Diego / Orquestra AI — 2026*
*Baseado em ideia de Felipe Amorim. Inspiração estrutural: XSD da NF-e brasileira.*
