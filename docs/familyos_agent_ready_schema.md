# FamilyOS — Agent-Ready Schema

> Validação prática do modelo Agent-Ready Schema
> Sistema: FamilyOS (Telegram + SQLite + Gemini Flash + Hermes AGT)
> Autores: Diego & Nicolin

---

## Princípio

Cada operação tem três camadas:
1. **Esquema** — campos, tipos, validações, contexto obrigatório
2. **Risco** — nível de autonomia permitida ao agente
3. **Signpost** — o que o agente diz de volta após executar

Níveis de risco:
- 🟢 **LIVRE** — executa sozinho, sem confirmação
- 🟡 **VALIDADO** — executa após validar campos e regras
- 🟠 **CONTEXTUAL** — valida transição de estado, pode pausar
- 🔴 **CONFIRMAÇÃO** — pausa e consulta humano antes de executar

---

## MÓDULO FINANCEIRO

---

### OP-FIN-01 — Registrar gasto

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| descricao | string | Obrigatório, mín. 3 chars |
| valor | decimal | Obrigatório, > 0 |
| categoria_id | int FK | Obrigatório — validar existência em categorias.ativo=true |
| membro_id | int FK | Obrigatório — inferir do contexto Hermes se não informado |
| data | date YYYY-MM-DD | Default: hoje |
| conta | enum | inter \| c6 \| santander \| cartao \| dinheiro — Default: inferir do contexto |
| fonte | enum | manual \| ocr \| extrato \| hermes — Default: hermes |
| reembolso | bool | Default: false |
| reembolso_por | string | Obrigatório se reembolso=true |

**Validações:**
- mês não pode estar fechado (meses.fechado=false)
- se valor > 500: confirmar com usuário antes de salvar
- após salvar: checar se categoria atingiu 80% ou 100% do orçamento

**Signpost:**
```json
{
  "status": 201,
  "data": { "gasto_id": "...", "categoria": "...", "envelope_usado": "68%" },
  "alerta": "Envelope Alimentação em 80% do orçamento mensal.",
  "next": "Para corrigir categoria use atualizar_gasto com o id. Para ver resumo do mês use consulta_mes."
}
```

---

### OP-FIN-02 — Registrar gasto por OCR (foto)

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| imagem | base64 | Obrigatório |
| membro_id | int FK | Inferir do contexto |

**Validações:**
- OCR extrai: valor, data, estabelecimento
- Gemini categoriza automaticamente
- se confiança < 80%: apresentar ao usuário para confirmar antes de salvar
- salvar ocr_texto original para auditoria

**Signpost:**
```json
{
  "status": 201,
  "data": { "extraido": { "valor": 47.50, "local": "Supermercado X", "data": "2026-06-12" }, "categoria_sugerida": "Alimentação" },
  "next": "Gasto registrado. Para corrigir qualquer campo use atualizar_gasto."
}
```

---

### OP-FIN-03 — Registrar entrada

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| descricao | string | Obrigatório |
| valor | decimal | Obrigatório, > 0 |
| membro_id | int FK | Obrigatório |
| tipo | enum | salario \| freelance \| reembolso \| pix \| transferencia \| outro |
| conta | enum | inter \| c6 \| santander \| cartao \| dinheiro |
| data | date | Default: hoje |
| recorrente | bool | Default: false |

**Signpost:**
```json
{
  "status": 201,
  "data": { "entrada_id": "...", "tipo": "salario", "valor": 6000 },
  "next": "Entrada registrada. Para ver saldo do mês use consulta_mes. Para registrar aporte em meta use aporte_meta."
}
```

---

### OP-FIN-04 — Consultar mês

**Risco:** 🟢 LIVRE

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| ano | int | Default: ano atual |
| mes | int | Default: mês atual |
| membro_id | int FK | Opcional — se null, retorna consolidado da família |

**Retorna:** total gastos, total entradas, saldo, breakdown por categoria, envelopes no limite

**Signpost:**
```json
{
  "status": 200,
  "data": { "saldo": 1240.50, "gastos": 3800, "entradas": 5040, "envelopes_alerta": ["Lazer", "Alimentação"] },
  "next": "Para ver detalhes de uma categoria use consulta_categoria. Para projeção do fim do mês use projecao_mes."
}
```

---

### OP-FIN-05 — Atualizar gasto

**Risco:** 🟠 CONTEXTUAL

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| gasto_id | int PK | Obrigatório |
| campo | string | Obrigatório — qual campo alterar |
| novo_valor | any | Obrigatório |

**Validações:**
- mês do gasto não pode estar fechado
- se alterar valor: checar impacto no envelope novamente
- apresentar o estado anterior antes de confirmar

**Signpost:**
```json
{
  "status": 200,
  "data": { "anterior": { "categoria": "Lazer", "valor": 120 }, "atual": { "categoria": "Alimentação", "valor": 120 } },
  "next": "Gasto atualizado. Envelopes recalculados."
}
```

---

### OP-FIN-06 — Deletar gasto

**Risco:** 🔴 CONFIRMAÇÃO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| gasto_id | int PK | Obrigatório |
| confirmacao | string | Deve conter "CONFIRMAR" |

**Validações:**
- mês não pode estar fechado
- apresentar resumo do gasto antes de deletar
- exigir confirmação explícita

**Signpost:**
```json
{
  "status": 202,
  "pending": true,
  "message": "Isso vai remover: R$47,50 em Alimentação em 12/06. Responda CONFIRMAR para prosseguir."
}
```

---

### OP-FIN-07 — Fechar mês

**Risco:** 🔴 CONFIRMAÇÃO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| ano | int | Obrigatório |
| mes | int | Obrigatório |
| confirmacao | string | Deve conter "CONFIRMAR" |

**Validações:**
- mês deve existir
- apresentar resumo completo antes de fechar
- após fechar: nenhum gasto ou entrada pode ser alterado neste mês

**Signpost:**
```json
{
  "status": 200,
  "data": { "mes_fechado": "2026-05", "total_gastos": 4200, "total_entradas": 5040, "saldo": 840 },
  "next": "Mês fechado. Registros bloqueados para edição. Use consulta_mes para histórico."
}
```

---

### OP-FIN-08 — Registrar aporte em meta

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| meta_id | int FK | Obrigatório — validar meta.status=ativa |
| valor | decimal | Obrigatório, > 0 |
| data | date | Default: hoje |
| descricao | string | Opcional |

**Validações:**
- meta deve estar ativa
- valor_atual + aporte não pode ultrapassar valor_alvo (avisar se sim)

**Signpost:**
```json
{
  "status": 201,
  "data": { "meta": "Reserva de emergência", "progresso": "67%", "falta": 1650 },
  "next": "Aporte registrado. Para ver todas as metas use consulta_metas."
}
```

---

## MÓDULO TAREFAS & LEMBRETES

---

### OP-TAR-01 — Criar tarefa

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| titulo | string | Obrigatório, mín. 3 chars |
| responsavel_id | int FK | Obrigatório — inferir do contexto |
| prioridade | enum | baixa \| media \| alta — Default: media |
| data_vencimento | date | Opcional |
| descricao | string | Opcional |
| origem | enum | manual \| gmail \| hermes \| calendar — Default: hermes |

**Signpost:**
```json
{
  "status": 201,
  "data": { "tarefa_id": "...", "titulo": "Comprar remédio", "vencimento": "2026-06-15" },
  "next": "Tarefa criada. Para criar lembrete vinculado use criar_lembrete com tarefa_id."
}
```

---

### OP-TAR-02 — Criar lembrete

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| membro_id | int FK | Obrigatório |
| mensagem | string | Obrigatório |
| agendado_para | datetime | Obrigatório — deve ser futuro |
| tarefa_id | int FK | Opcional — vincula ao lembrete |

**Validações:**
- agendado_para deve ser no futuro
- não criar duplicata (mesma mensagem + mesmo horário + mesmo membro)

**Signpost:**
```json
{
  "status": 201,
  "data": { "lembrete_id": "...", "agendado_para": "2026-06-13 09:00" },
  "next": "Lembrete agendado. O cron vai enviar no horário via Telegram."
}
```

---

### OP-TAR-03 — Atualizar status da tarefa

**Risco:** 🟠 CONTEXTUAL

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| tarefa_id | int PK | Obrigatório |
| novo_status | enum | pendente \| em_progresso \| concluida \| cancelada |
| motivo | string | Obrigatório se cancelada |

**Validações:**
- concluida → não pode voltar para pendente (apresentar aviso)
- cancelada → exige motivo

**Signpost:**
```json
{
  "status": 200,
  "data": { "tarefa": "Comprar remédio", "status_anterior": "pendente", "status_atual": "concluida" },
  "next": "Tarefa concluída. Para ver tarefas pendentes use listar_tarefas."
}
```

---

## MÓDULO VEÍCULOS

---

### OP-VEI-01 — Registrar abastecimento

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| veiculo_id | int FK | Obrigatório |
| litros | decimal | Obrigatório, > 0 |
| valor_total | decimal | Obrigatório, > 0 |
| km_atual | decimal | Obrigatório — deve ser >= km anterior do veículo |
| tipo_combustivel | enum | gasolina \| etanol \| diesel \| gnv |
| posto | string | Opcional |
| data | date | Default: hoje |

**Validações:**
- km_atual deve ser maior que km anterior registrado
- calcular e retornar preco_litro automaticamente
- calcular média km/l desde último abastecimento

**Signpost:**
```json
{
  "status": 201,
  "data": { "preco_litro": 6.22, "media_kml": 11.4, "km_rodados_desde_ultimo": 420 },
  "next": "Abastecimento registrado. Km do veículo atualizado para 47.320."
}
```

---

### OP-VEI-02 — Registrar manutenção

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| veiculo_id | int FK | Obrigatório |
| tipo | enum | oleo \| pneu \| filtro \| freio \| revisao \| ipva \| licenciamento \| seguro \| outro |
| custo | decimal | Obrigatório, > 0 |
| data_realizada | date | Default: hoje |
| proxima_data | date | Opcional — criar lembrete automático se informado |
| proximo_km | decimal | Opcional |
| local | string | Opcional |

**Validações:**
- se proxima_data informado: criar lembrete automático 7 dias antes

**Signpost:**
```json
{
  "status": 201,
  "data": { "manutencao_id": "...", "tipo": "oleo", "proxima_data": "2026-12-12" },
  "next": "Manutenção registrada. Lembrete automático criado para 2026-12-05.",
  "alerta": "IPVA vence em 45 dias. Deseja registrar já?"
}
```

---

## MÓDULO SAÚDE

---

### OP-SAU-01 — Consultar ficha médica

**Risco:** 🟢 LIVRE

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| membro_id | int FK | Obrigatório |

**Retorna:** tipo sanguíneo, alergias, condições, plano de saúde, médico responsável

**Signpost:**
```json
{
  "status": 200,
  "data": { "membro": "Diego", "tipo_sanguineo": "O+", "alergias": ["Dipirona"], "plano": "Amil" },
  "next": "Para atualizar ficha use atualizar_ficha_medica. Para ver medicamentos use consultar_medicamentos."
}
```

---

### OP-SAU-02 — Registrar vacina

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| membro_id | int FK | Obrigatório |
| nome | string | Obrigatório |
| data_aplicacao | date | Default: hoje |
| proxima_dose | date | Opcional — criar lembrete automático |
| local | string | Opcional |
| lote | string | Opcional |

**Validações:**
- se proxima_dose informado: criar lembrete 30 dias antes

**Signpost:**
```json
{
  "status": 201,
  "data": { "vacina": "Gripe", "membro": "Nicolin", "proxima_dose": "2027-04-01" },
  "next": "Vacina registrada. Lembrete criado para 2027-03-02."
}
```

---

## MÓDULO DATAS IMPORTANTES

---

### OP-DAT-01 — Registrar data importante

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| titulo | string | Obrigatório |
| data | date YYYY-MM-DD | Obrigatório |
| tipo | enum | aniversario \| casamento \| renovacao \| vencimento \| feriado \| escola \| religioso \| outro |
| recorrente | bool | Default: true para aniversario e casamento |
| membro_id | int FK | Opcional |
| dias_antecipar_lembrete | int | Default: 3 |
| emoji | string | Opcional |

**Signpost:**
```json
{
  "status": 201,
  "data": { "titulo": "Aniversário Nicolin", "data": "1990-09-15", "lembrete_em": "3 dias antes" },
  "next": "Data registrada. Lembrete automático configurado."
}
```

---

## MÓDULO CARDÁPIO & COMPRAS

---

### OP-CAR-01 — Consultar cardápio da semana

**Risco:** 🟢 LIVRE

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| semana_inicio | date | Default: segunda-feira atual |

**Signpost:**
```json
{
  "status": 200,
  "data": { "semana": "2026-06-09", "refeicoes": [...] },
  "next": "Para adicionar refeição use registrar_cardapio. Para gerar lista de compras use gerar_lista_compras."
}
```

---

### OP-CAR-02 — Gerar lista de compras

**Risco:** 🟡 VALIDADO

**Campos:**
| Campo | Tipo | Regra |
|-------|------|-------|
| semana_inicio | date | Default: semana atual |

**Validações:**
- deve existir cardápio para a semana
- se lista já existe para a semana: perguntar se quer sobrescrever

**Signpost:**
```json
{
  "status": 201,
  "data": { "itens": 14, "estimativa_total": 180.00 },
  "next": "Lista criada com 14 itens. Para marcar item como comprado use marcar_comprado."
}
```

---

## MAPA DE AUTONOMIA — RESUMO

| Operação | Módulo | Risco | Autonomia |
|----------|--------|-------|-----------|
| Consultar mês | Financeiro | 🟢 | Executa livre |
| Consultar ficha médica | Saúde | 🟢 | Executa livre |
| Consultar cardápio | Cardápio | 🟢 | Executa livre |
| Registrar gasto | Financeiro | 🟡 | Valida antes |
| Registrar gasto (OCR) | Financeiro | 🟡 | Valida confiança OCR |
| Registrar entrada | Financeiro | 🟡 | Valida campos |
| Aporte em meta | Financeiro | 🟡 | Valida meta ativa |
| Criar tarefa | Tarefas | 🟡 | Valida campos |
| Criar lembrete | Tarefas | 🟡 | Valida futuro + duplicata |
| Registrar abastecimento | Veículos | 🟡 | Valida km sequência |
| Registrar manutenção | Veículos | 🟡 | Cria lembrete automático |
| Registrar vacina | Saúde | 🟡 | Cria lembrete automático |
| Registrar data importante | Datas | 🟡 | Valida campos |
| Gerar lista de compras | Cardápio | 🟡 | Valida cardápio existente |
| Atualizar gasto | Financeiro | 🟠 | Valida mês aberto + impacto |
| Atualizar status tarefa | Tarefas | 🟠 | Valida transição de estado |
| Deletar gasto | Financeiro | 🔴 | Exige CONFIRMAR explícito |
| Fechar mês | Financeiro | 🔴 | Exige CONFIRMAR explícito |

---

## COMO USAR PARA VALIDAÇÃO

### Fase 1 — Sem esquema (baseline)
Rodar 10 intenções reais no Hermes AGT sem nenhum esquema.
Documentar: onde travou, onde executou errado, onde pediu confirmação desnecessária, onde executou algo sem deveria ter perguntado.

### Fase 2 — Com esquema
Implementar os esquemas acima como system prompt estruturado do Hermes.
Rodar as mesmas 10 intenções.
Documentar a diferença de comportamento.

### Métricas de comparação
- Taxa de execução correta sem intervenção humana
- Número de confirmações desnecessárias
- Número de operações executadas sem validação que deveriam ter validado
- Qualidade do signpost (o agente comunicou o próximo passo?)

---

*FamilyOS Agent-Ready Schema v1.0 — Diego & Nicolin — 2026*
*Baseado em: Felipe Amorim — "The A in API No Longer Means Application"*
