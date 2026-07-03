---
title: Writing Schemas
description: How to define operations and constraints
---

Agent-Ready Schemas are written in YAML and follow a strict, human-readable structure.

## Basic Structure

```yaml
schema_version: "0.1"
module: financeiro
system: family_os

operations:
  - id: OP-FIN-01
    name: registrar_gasto
    description: Registra um novo gasto no banco de dados.
    risk_level: free
    
    autonomy_policy:
      mode: unsupervised
      
    input_schema:
      - name: valor
        type: number
        required: true
        description: O valor do gasto.
      - name: descricao
        type: string
        required: true
```

## Adding Constraints
You can add business rules directly to fields:

```yaml
      - name: valor
        type: number
        required: true
        constraints:
          - rule: GT
            value: 0
            message: O valor não pode ser negativo ou zero.
```

## State Guards
State guards check the real-time state of the backend before allowing the operation:

```yaml
    state_guards:
      - predicate: "month.is_open"
        params:
          ano: "{{context.year}}"
          mes: "{{context.month}}"
        error_message: "Não é possível registrar gastos em um mês já fechado."
```
