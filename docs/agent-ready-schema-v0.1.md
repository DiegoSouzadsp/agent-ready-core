# Agent-Ready Schema — Especificação v0.1

> Proposta de padrão aberto para sistemas operáveis por agentes com autonomia segura.
> Status: Draft — Primeira implementação experimental: FamilyOS

---

## Motivação

APIs foram sempre projetadas para humanos programarem.
O agente é o primeiro consumidor que lê, interpreta e decide.

Mas leitura não é suficiente. Para que um agente opere um sistema com autonomia real — sem loop humano a cada passo — o sistema precisa expor contratos que o agente possa carregar e validar, não apenas documentação que o agente tenta seguir.

Agent-Ready Schema é esse contrato.

---

## Estrutura de um schema

Todo schema Agent-Ready é um arquivo YAML com os seguintes campos de nível superior:

```yaml
schema_version: string       # versão do padrão (ex: "0.1")
module: string               # nome do módulo (ex: financeiro)
system: string               # nome do sistema (ex: familyos)
updated_at: date             # data da última atualização
operations: list[Operation]  # lista de operações
```

---

## Estrutura de uma Operation

```yaml
id: string
# Identificador único. Formato recomendado: OP-{MODULO}-{SEQ}
# Ex: OP-FIN-01

name: string
# Nome snake_case da operação. Usado pelo agente para referenciar.
# Ex: registrar_gasto

description: string
# Descrição em linguagem natural do que a operação faz.

module: string
# Módulo ao qual pertence.

risk_level: enum
# Nível de risco da operação. Ver tabela de níveis abaixo.
# Valores: free | validated | contextual | confirmation

autonomy_policy: enum
# Política de execução derivada do risk_level.
# Valores: execute_immediately | execute_after_validation |
#          validate_state_then_execute | require_explicit_confirmation

input_schema: map[string, Field]
# Campos de entrada. Ver estrutura Field abaixo.

validation_rules: list[ValidationRule]   # opcional
# Regras de validação além dos campos (ex: sem duplicata, confiança OCR).

state_guards: list[StateGuard]           # opcional
# Condições de estado do sistema que devem ser verdadeiras antes de executar.

human_confirmation: HumanConfirmation    # obrigatório se risk_level == confirmation
# Configuração da confirmação explícita exigida.

computed_fields: list[ComputedField]     # opcional
# Campos calculados automaticamente a partir dos inputs.

side_effects: list[SideEffect]           # opcional
# Ações colaterais disparadas após execução bem-sucedida.

signpost: Signpost
# O que o agente deve retornar após a operação. Ver estrutura Signpost abaixo.

audit: Audit
# Configuração de auditoria e log.
```

---

## Níveis de risco

| risk_level   | autonomy_policy                    | Descrição |
|--------------|-----------------------------------|-----------|
| free         | execute_immediately                | Leitura pura. Nenhum estado modificado. Agente executa direto. |
| validated    | execute_after_validation           | Cria ou modifica estado. Agente valida campos e regras antes. |
| contextual   | validate_state_then_execute        | Modifica estado existente. Agente verifica transições válidas. Pode pausar se ambíguo. |
| confirmation | require_explicit_confirmation      | Irreversível. Agente apresenta resumo e exige token de confirmação antes de executar. |

---

## Estrutura Field

```yaml
field_name:
  type: string | int | decimal | bool | date | datetime | enum | base64 | any
  required: bool
  required_if:                    # opcional — condicional
    field: string
    value: any
  default: any                    # opcional
  default_by_tipo: map            # opcional — default por valor de outro campo
  infer_from_context: bool        # opcional — agente busca no contexto Hermes
  min_length: int                 # opcional — para string
  max_length: int                 # opcional — para string
  min: number                     # opcional — para numeric
  max: number                     # opcional — para numeric
  gt: number                      # opcional — greater than
  gte: number                     # opcional — greater than or equal
  format: string                  # opcional — ex: YYYY-MM-DD
  values: list                    # obrigatório para type: enum
  must_be: string                 # opcional — ex: future (para datetime)
  must_contain: string            # opcional — para confirmações explícitas
  foreign_key:                    # opcional
    table: string
    filter: map                   # opcional — WHERE conditions
  description: string             # opcional — anotação humana
  human_confirmation_if:          # opcional — pausa para confirmação se condição for verdadeira
    gt: number
    gte: number
    lt: number
    lte: number
    eq: any
```

---

## Estrutura ValidationRule

```yaml
- id: string
  description: string
  query: string                   # SQL com :params
  assert: map                     # condição que deve ser verdadeira
  assert_empty: bool              # resultado deve ser vazio
  check: string                   # expressão booleana (ex: ocr_confidence >= 0.8)
  warn_if: map                    # condição que dispara aviso (não bloqueia)
  policy: show_diff | human_confirmation   # o que fazer quando a regra falha
  on_fail:
    message: string               # mensagem com template {{campo}}
    policy: string                # block | human_confirmation | warn
    suggest: string               # próxima ação sugerida
  transitions:                    # para validação de máquina de estados
    estado_atual: list[estados_permitidos]
  on_invalid:
    message: string
```

---

## Estrutura StateGuard

```yaml
- description: string
  query: string                   # SQL que retorna o estado atual
  assert: map                     # condição que deve ser verdadeira
  on_fail:
    message: string
    suggest: string               # próxima ação sugerida
```

---

## Estrutura HumanConfirmation

```yaml
required: bool
message_template: string          # mensagem com template {{campo}} mostrada antes de executar
pending_status: int               # HTTP status code enquanto aguarda (ex: 202)
```

---

## Estrutura ComputedField

```yaml
- name: string
  formula: string                 # expressão aritmética com campos do input e queries
```

---

## Estrutura SideEffect

```yaml
- id: string
  description: string
  trigger_if_field_present: string    # executa somente se campo estiver presente
  trigger_if_field_changed: list      # executa somente se algum desses campos mudou
  query: string                       # SQL executado como efeito colateral
  action: string                      # nome de outra operação a disparar
  params: map                         # parâmetros passados para a ação
  alert_if: map                       # condição que gera alerta no signpost
  message_template: string
  dias_antes: int                     # para side effects de lembrete
```

---

## Estrutura Signpost

```yaml
success:
  include: list[string]           # campos do resultado a incluir na resposta
  message: string                 # mensagem fixa opcional
  message_template: string        # mensagem com template {{campo}}
  alerts: list[string]            # ids de side_effects cujos alertas devem aparecer
  next_actions: list[string]      # operações que o agente pode fazer a seguir

pending:                          # para risk_level: confirmation antes da confirmação
  message_template: string
  include: list[string]

validation_error:
  message: string
  include_errors: bool
  next_actions: list[string]

blocked_transition:               # para risk_level: contextual
  message_template: string

low_confidence:                   # para operações com OCR ou inferência
  message: string
  include: list[string]
```

---

## Estrutura Audit

```yaml
log: bool
include_fields: list[string]      # campos a incluir no log de auditoria
```

---

## Como o agente usa o schema

1. **Recebe intenção** do humano em linguagem natural
2. **Identifica a operação** pelo name ou description
3. **Carrega o schema** da operação
4. **Extrai campos** da intenção, inferindo do contexto quando `infer_from_context: true`
5. **Valida campos** contra input_schema
6. **Executa state_guards** — se falhar, retorna mensagem e para
7. **Executa validation_rules** — se falhar, aplica política (block / warn / human_confirmation)
8. **Verifica human_confirmation** — se risk_level == confirmation, pausa e aguarda
9. **Executa a operação**
10. **Executa side_effects**
11. **Retorna signpost** com resultado, alertas e next_actions

---

## Mapa de compatibilidade com padrões existentes

| Padrão | Relação com Agent-Ready Schema |
|--------|-------------------------------|
| OpenAPI | Descreve estrutura de endpoints. ARS descreve semântica de operações. Complementares. |
| MCP | Descobre ferramentas disponíveis. ARS governa o que cada ferramenta pode fazer. Complementares. |
| JSON Schema | Valida estrutura de dados. ARS valida intenção + estado + risco. ARS inclui JSON Schema. |
| XSD (NF-e) | Inspiração direta. ARS generaliza o conceito de schema-como-governança para qualquer operação. |

---

## Versionamento

O campo `schema_version` segue semver simplificado: `MAJOR.MINOR`

- `MAJOR` muda quando há quebra de compatibilidade
- `MINOR` muda quando novos campos opcionais são adicionados

Versão atual: **0.1** (Draft — sujeito a mudanças)

---

## Implementações de referência

| Sistema | Repositório | Status |
|---------|-------------|--------|
| FamilyOS | /schemas/familyos/ | Experimental |

---

*Agent-Ready Schema v0.1 — Diego / Orquestra AI — 2026*
*Inspirado em: Felipe Amorim — "The A in API No Longer Means Application"*
*Inspiração estrutural: XSD da NF-e brasileira*
